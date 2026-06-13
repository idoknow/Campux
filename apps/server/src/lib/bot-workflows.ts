import { randomBytes } from "node:crypto";
import { hashPassword, type TenantRole } from "@campux/db";
import { hasTenantRole } from "./auth";
import { writeAuditLog } from "./audit";
import { prisma } from "./prisma";
import { decryptJson, encryptJson } from "./secret-json";
import { enqueuePublishFanout } from "../runtime/publishing";
import { addApprovedPostToBatch } from "../runtime/publish-batching";
import { readTenantPublishMode } from "./tenant-metadata";
import type { RuntimeQueue } from "../runtime/queue";
import { publishToQZone, QZonePublishError } from "@campux/integrations";

export const qzoneCookieDomain = "user.qzone.qq.com";

export type BotWorkflowResultUser = {
  id: string;
  qqUin: string;
  displayName: string | null;
};

export function generateBotPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export async function registerUserViaBot({
  botQqUin,
  userQqUin,
  displayName,
  password = generateBotPassword(),
  role = "submitter",
  resetExistingPassword = false,
}: {
  botQqUin: string;
  userQqUin: string;
  displayName?: string | null | undefined;
  password?: string;
  role?: TenantRole;
  resetExistingPassword?: boolean;
}) {
  const bot = await findEnabledBot(botQqUin);
  const existingUser = await prisma.user.findUnique({
    where: {
      qqUin: BigInt(userQqUin),
    },
    include: {
      memberships: true,
    },
  });
  const existingMembership = existingUser?.memberships.find((membership) => membership.tenantId === bot.tenantId);
  const shouldSetPassword = !existingUser || resetExistingPassword;
  const passwordHash = shouldSetPassword ? await hashPassword(password) : null;

  const user = existingUser
    ? await prisma.user.update({
        where: {
          id: existingUser.id,
        },
        data: {
          ...(passwordHash ? { passwordHash } : {}),
          ...(passwordHash ? { passwordChangeRequired: true } : {}),
          ...(!existingUser.displayName && displayName ? { displayName } : {}),
        },
      })
    : await prisma.user.create({
        data: {
          qqUin: BigInt(userQqUin),
          passwordHash: passwordHash ?? (await hashPassword(password)),
          passwordChangeRequired: true,
          ...(displayName ? { displayName } : {}),
        },
      });

  const membershipRole = existingMembership && hasTenantRole(existingMembership.role, role) ? existingMembership.role : role;
  const membership = existingMembership
    ? membershipRole === existingMembership.role
      ? existingMembership
      : await prisma.tenantMembership.update({
          where: {
            id: existingMembership.id,
          },
          data: {
            role: membershipRole,
          },
        })
    : await prisma.tenantMembership.create({
        data: {
          tenantId: bot.tenantId,
          userId: user.id,
          role: membershipRole,
        },
      });

  await markBotSeen(bot.id);
  await writeAuditLog({
    tenantId: bot.tenantId,
    actorId: user.id,
    action: existingMembership ? "bot.membership.update" : "bot.register",
    targetType: "membership",
    targetId: membership.id,
    detail: {
      botQqUin,
      userQqUin,
      requestedRole: role,
      role: membershipRole,
      resetExistingPassword,
    },
  });

  return {
    bot,
    user: serializeUser(user),
    membership,
    password: shouldSetPassword ? password : null,
    alreadyHadAccount: Boolean(existingUser),
    alreadyHadTenantAccess: Boolean(existingMembership),
  };
}

export async function resetPasswordViaBot({
  botQqUin,
  userQqUin,
  password = generateBotPassword(),
}: {
  botQqUin: string;
  userQqUin: string;
  password?: string;
}) {
  const bot = await findEnabledBot(botQqUin);
  const user = await prisma.user.findUnique({
    where: {
      qqUin: BigInt(userQqUin),
    },
    include: {
      memberships: true,
    },
  });

  const membership = user?.memberships.find((item) => item.tenantId === bot.tenantId);
  if (!user || !membership) {
    throw new BotWorkflowError("账号还没有注册这个校园墙，请先发送 #注册账号", 404);
  }

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash: await hashPassword(password),
      passwordChangeRequired: true,
    },
  });
  await markBotSeen(bot.id);
  await writeAuditLog({
    tenantId: bot.tenantId,
    actorId: user.id,
    action: "bot.password.reset",
    targetType: "user",
    targetId: user.id,
    detail: {
      botQqUin,
      userQqUin,
    },
  });

  return {
    bot,
    user: serializeUser(user),
    password,
  };
}

export async function reviewPostViaBot({
  queue,
  botQqUin,
  groupId,
  operatorQqUin,
  displayId,
  action,
  comment,
}: {
  queue: RuntimeQueue;
  botQqUin: string;
  groupId?: string | null | undefined;
  operatorQqUin: string;
  displayId: number;
  action: "approve" | "reject";
  comment?: string | null | undefined;
}) {
  const bot = await findEnabledBot(botQqUin);
  assertReviewGroup(bot, groupId);
  const { operator } = await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");
  const post = await prisma.post.findFirst({
    where: {
      tenantId: bot.tenantId,
      displayId,
    },
    include: {
      author: true,
    },
  });

  if (!post) {
    throw new BotWorkflowError(`稿件 #${displayId} 不存在`, 404);
  }
  if (post.status !== "pending_approval") {
    throw new BotWorkflowError(`稿件 #${displayId} 当前不是待审核状态`, 409);
  }

  const nextStatus = action === "approve" ? "approved" : "rejected";
  const reviewed = await prisma.post.update({
    where: {
      id: post.id,
    },
    data: {
      status: nextStatus,
      logs: {
        create: {
          tenantId: bot.tenantId,
          actorId: operator.id,
          oldStatus: post.status,
          newStatus: nextStatus,
          comment: comment?.trim() || `审核群命令${action === "approve" ? "通过" : "拒绝"}`,
        },
      },
    },
    include: {
      author: true,
    },
  });

  await markBotSeen(bot.id);
  await writeAuditLog({
    tenantId: bot.tenantId,
    actorId: operator.id,
    action: `bot.review.${action}`,
    targetType: "post",
    targetId: post.id,
    detail: {
      displayId: post.displayId,
      groupId: groupId ?? null,
      comment: comment?.trim() || null,
    },
  });

  if (action === "approve") {
    const publishMode = await readTenantPublishMode(prisma, bot.tenantId);
    if (publishMode.mode === "accumulate") {
      await addApprovedPostToBatch(queue, bot.tenantId, post.id, operator.id);
    } else {
      await enqueuePublishFanout(queue, bot.tenantId, post.id, operator.id);
    }
  }

  return {
    bot,
    post: reviewed,
    operator: serializeUser(operator),
  };
}

export async function refreshQZoneCookiesViaBot({
  botQqUin,
  operatorQqUin,
  groupId,
  rawCookies,
}: {
  botQqUin: string;
  operatorQqUin: string;
  groupId?: string | null | undefined;
  rawCookies: string;
}) {
  const bot = await findEnabledBot(botQqUin);
  assertReviewGroup(bot, groupId);
  const { operator } = await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");
  const result = await refreshQZoneCookiesForBot({
    botQqUin,
    rawCookies,
    actorId: operator.id,
    action: "bot.qzone.cookies.refresh",
    detail: {
      groupId: groupId ?? null,
      source: "review_group",
    },
  });

  return {
    bot,
    operator: serializeUser(operator),
    session: result.session,
    cookieNames: result.cookieNames,
  };
}

export async function refreshQZoneCookiesForBot({
  botQqUin,
  rawCookies,
  actorId,
  action = "bot.qzone.cookies.auto_refresh",
  detail,
}: {
  botQqUin: string;
  rawCookies: string;
  actorId?: string | null;
  action?: string;
  detail?: Record<string, unknown>;
}) {
  const bot = await findEnabledBot(botQqUin);
  const cookies = parseCookieString(rawCookies);

  if (!cookies.p_skey && !cookies.skey) {
    throw new BotWorkflowError("协议端没有返回有效的 QZone cookies", 502);
  }

  const session = await prisma.botSession.upsert({
    where: {
      botAccountId_type_domain: {
        botAccountId: bot.id,
        type: "qzone",
        domain: qzoneCookieDomain,
      },
    },
    update: {
      cookies: encryptJson(cookies),
      rawCookies: null,
      refreshedAt: new Date(),
      expiresAt: null,
      healthStatus: "unchecked",
      healthCheckedAt: null,
      healthMessage: "cookies 已刷新，等待可用性检测",
      healthFailureCount: 0,
      healthInvalidNotifiedAt: null,
    },
    create: {
      botAccountId: bot.id,
      type: "qzone",
      domain: qzoneCookieDomain,
      cookies: encryptJson(cookies),
      rawCookies: null,
      healthMessage: "cookies 已刷新，等待可用性检测",
    },
  });

  await markBotSeen(bot.id);
  await writeAuditLog({
    tenantId: bot.tenantId,
    actorId: actorId ?? null,
    action,
    targetType: "bot_session",
    targetId: session.id,
    detail: {
      botQqUin,
      cookieNames: Object.keys(cookies),
      ...detail,
    },
  });

  return {
    bot,
    session,
    cookieNames: Object.keys(cookies),
  };
}

export function parseCookieString(rawCookies: string) {
  const cookies: Record<string, string> = {};
  for (const rawPart of rawCookies.split(";")) {
    const [name, ...valueParts] = rawPart.trim().split("=");
    const value = valueParts.join("=");
    if (name && value) {
      cookies[name] = value;
    }
  }
  return cookies;
}

export async function findEnabledBot(botQqUin: string) {
  const bot = await prisma.botAccount.findUnique({
    where: {
      qqUin: BigInt(botQqUin),
    },
  });
  if (!bot || !bot.enabled) {
    throw new BotWorkflowError("Bot 未绑定校园墙", 404);
  }
  return bot;
}

export function assertReviewGroup(bot: Awaited<ReturnType<typeof findEnabledBot>>, groupId?: string | null) {
  if (bot.reviewGroupId && groupId && bot.reviewGroupId !== groupId) {
    throw new BotWorkflowError("审核群不属于这个校园墙", 403);
  }
}

export async function requireBotTenantRole(tenantId: string, qqUin: string, requiredRole: TenantRole) {
  const operator = await prisma.user.findUnique({
    where: {
      qqUin: BigInt(qqUin),
    },
    include: {
      memberships: true,
    },
  });
  const membership = operator?.memberships.find((item) => item.tenantId === tenantId);
  if (!operator || !membership || !hasTenantRole(membership.role, requiredRole)) {
    throw new BotWorkflowError(requiredRole === "admin" ? "没有校园墙管理权限" : "没有审核权限", 403);
  }

  return {
    operator,
    membership,
  };
}

export async function publishTextDirectViaBot({
  botQqUin,
  groupId,
  operatorQqUin,
  text,
  images,
}: {
  botQqUin: string;
  groupId?: string | null | undefined;
  operatorQqUin: string;
  text: string;
  images?: Array<{ name: string; bytes: Uint8Array }>;
}) {
  const bot = await findEnabledBot(botQqUin);
  assertReviewGroup(bot, groupId);
  const { operator } = await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");

  if (!text.trim()) {
    throw new BotWorkflowError("发布内容不能为空", 400);
  }
  if (text.length > 1_000) {
    throw new BotWorkflowError("发布内容太长，请控制在 1000 字以内", 400);
  }

  // 获取 QZone cookies
  const session = await prisma.botSession.findFirst({
    where: {
      botAccountId: bot.id,
      type: "qzone",
      domain: qzoneCookieDomain,
    },
    orderBy: { refreshedAt: "desc" },
  });

  if (!session || session.healthStatus !== "available") {
    throw new BotWorkflowError("机器人 QZone 登录态不可用，请先扫码登录", 502);
  }

  const cookies = decryptJson(session.cookies) as Record<string, string> | null;
  if (!cookies) {
    throw new BotWorkflowError("机器人 QZone cookies 解析失败", 502);
  }

  if (images && images.length > 9) {
    throw new BotWorkflowError("最多 9 张图片", 400);
  }

  // 直接发布文本+图片说说到 QQ 空间，不走稿件流程
  const qzoneInput: Parameters<typeof publishToQZone>[0] = {
    tenantId: bot.tenantId,
    postId: "direct",
    targetId: "direct",
    targetName: bot.displayName ?? `QQ ${botQqUin}`,
    text: text.trim(),
    imageUrls: [],
    cookies,
  };
  if (images) {
    qzoneInput.images = images;
  }
  const result = await publishToQZone(qzoneInput);

  await markBotSeen(bot.id);
  await writeAuditLog({
    tenantId: bot.tenantId,
    actorId: operator.id,
    action: "bot.text.publish",
    targetType: "bot_account",
    targetId: bot.id,
    detail: {
      groupId: groupId ?? null,
      textLength: text.length,
      imageCount: images?.length ?? 0,
      externalId: result.externalId,
      qzoneTid: result.qzoneTid,
    },
  });

  return {
    bot,
    operator: serializeUser(operator),
    externalId: result.externalId,
    qzoneTid: result.qzoneTid,
  };
}

export class BotWorkflowError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

async function markBotSeen(botId: string) {
  await prisma.botAccount.update({
    where: {
      id: botId,
    },
    data: {
      lastSeenAt: new Date(),
    },
  });
}

function serializeUser(user: { id: string; qqUin: bigint; displayName: string | null }): BotWorkflowResultUser {
  return {
    id: user.id,
    qqUin: user.qqUin.toString(),
    displayName: user.displayName,
  };
}
