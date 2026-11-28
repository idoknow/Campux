import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";
import { writeAuditLog } from "./audit";

/**
 * 账号合并：把「靠私聊 Bot 建的旧账号」并入「网页注册的新账号」。
 *
 * 背景：同一个同学在无 Bot 期用网页注册了账号（QQ 号 A + 邮箱），
 * 后来又通过私聊墙号被自动建过号（QQ 号 B）。两边各有一批稿件，
 * 用户在新账号里看不到旧的，运营者统计也会分叉。
 *
 * 合并规则（安全优先）：
 * 1. 目标账号（新号）保留：QQ 号、邮箱、密码不变；
 * 2. 旧账号在当前墙的稿件与成员身份迁到新号；
 * 3. 旧账号被标记 `mergedAt` 并**不再参与登录**，数据保留可审计；
 * 4. 旧号的 QQ 号仍占用 unique 值，避免 Bot 重新建号时静默覆盖历史。
 *
 * 整个迁移在一个事务里完成。**注意**：Postgres 里事务内一条语句失败会让整个事务
 * 进入 aborted 状态，因此这里不用 `try/catch` 吞错，而是逐类关联先查后写、显式处理
 * unique 冲突。
 */

export class UserMergeError extends Error {
  constructor(
    message: string,
    readonly code: "OLD_NOT_FOUND" | "ALREADY_MERGED" | "SAME_USER" | "EMAIL_MISMATCH" | "NEW_MISSING" | "TARGET_MERGED",
  ) {
    super(message);
    this.name = "UserMergeError";
  }
}

export type MergeCandidate = {
  id: string;
  qqUin: bigint;
  email: string | null;
  displayName: string | null;
};

/** 找出「可以并入目标账号」的旧账号：未合并、不是自己。 */
export async function findMergeCandidate(
  client: typeof prisma | Prisma.TransactionClient,
  input: { targetUserId: string; oldQqUin: string },
): Promise<MergeCandidate | null> {
  let oldQqUin: bigint;
  try {
    oldQqUin = BigInt(input.oldQqUin);
  } catch {
    return null;
  }
  const old = await client.user.findUnique({
    where: { qqUin: oldQqUin },
    select: {
      id: true,
      qqUin: true,
      email: true,
      displayName: true,
      mergedAt: true,
    },
  });
  if (!old || old.id === input.targetUserId || old.mergedAt !== null) {
    return null;
  }
  return { id: old.id, qqUin: old.qqUin, email: old.email, displayName: old.displayName };
}

/**
 * 旧账号是否只属于当前这一个墙。
 *
 * 合并只迁当前墙的稿件与身份，却会做**全局**重定向（mergedIntoUserId），
 * 所以旧号若还属于别的墙，那些墙里再解析就会落到一个没有该墙身份的主账号上（404）。
 * 这种跨境合并必须由管理员按墙处理，不能自助完成。
 */
export async function isMergeScopeSingleTenant(
  client: typeof prisma | Prisma.TransactionClient,
  input: { oldQqUin: string; tenantId: string },
): Promise<boolean> {
  let oldQqUin: bigint;
  try {
    oldQqUin = BigInt(input.oldQqUin);
  } catch {
    return false;
  }
  const otherMemberships = await client.tenantMembership.count({
    where: { user: { qqUin: oldQqUin }, tenantId: { not: input.tenantId } },
  });
  return otherMemberships === 0;
}

export type MergePreview = {
  oldUserId: string;
  oldQqUin: string;
  oldEmail: string | null;
  oldDisplayName: string | null;
  oldPostCount: number;
  newUserId: string;
  newQqUin: string;
  newEmail: string | null;
};

/**
 * 生成合并预览。
 *
 * 跨墙限制在这里就要暴露（而不是等到最后提交）：
 * 否则用户会走完「查询 → 收验证码 → 填验证码」才被告知不能合并，
 * 既浪费一次验证码，也把他推向「找运维人工处理」这条绕过安全设计的路。
 */
export async function buildMergePreview(input: {
  tenantId: string;
  targetUserId: string;
  oldQqUin: string;
}): Promise<{ ok: true; preview: MergePreview } | { ok: false; reason: string; code: string }> {
  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, qqUin: true, email: true },
  });
  if (!target) {
    return { ok: false, reason: "当前账号不存在", code: "NEW_MISSING" };
  }
  const old = await findMergeCandidate(prisma, input);
  if (!old) {
    return { ok: false, reason: "没有找到这个 QQ 号对应的可合并旧账号", code: "OLD_NOT_FOUND" };
  }
  if (!await isMergeScopeSingleTenant(prisma, { oldQqUin: input.oldQqUin, tenantId: input.tenantId })) {
    return {
      ok: false,
      code: "CROSS_TENANT",
      reason: "这个旧账号还属于其他校园墙，无法在这里自助合并，请联系系统运维处理",
    };
  }
  const oldPostCount = await prisma.post.count({
    where: { tenantId: input.tenantId, authorId: old.id },
  });
  return {
    ok: true,
    preview: {
      oldUserId: old.id,
      oldQqUin: old.qqUin.toString(),
      oldEmail: old.email,
      oldDisplayName: old.displayName,
      oldPostCount,
      newUserId: target.id,
      newQqUin: target.qqUin.toString(),
      newEmail: target.email,
    },
  };
}

/**
 * 执行合并。调用方负责先做验证码校验与权限校验。
 */
export async function mergeUserAccounts(input: {
  tenantId: string;
  targetUserId: string;
  oldQqUin: string;
  actorId: string;
}): Promise<{ mergeId: string; migratedPosts: number; migratedMemberships: number; oldQqUin: string }> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, qqUin: true, email: true, mergedAt: true },
    });
    if (!target) {
      throw new UserMergeError("当前账号不存在", "NEW_MISSING");
    }
    if (target.mergedAt !== null) {
      throw new UserMergeError("当前账号已被并入其他账号，无法作为合并目标", "TARGET_MERGED");
    }

    const old = await findMergeCandidate(tx, input);
    if (!old) {
      // 区分「不存在」与「已合并」，给出可操作的提示。
      let existing: { mergedAt: Date | null; id: string } | null = null;
      try {
        existing = await tx.user.findUnique({ where: { qqUin: BigInt(input.oldQqUin) }, select: { mergedAt: true, id: true } });
      } catch {
        existing = null;
      }
      if (existing && existing.id === target.id) {
        throw new UserMergeError("不能把账号合并到它自己", "SAME_USER");
      }
      throw new UserMergeError(
        existing?.mergedAt ? "这个旧账号已经合并过了，无需重复操作" : "没有找到这个 QQ 号对应的旧账号",
        existing?.mergedAt ? "ALREADY_MERGED" : "OLD_NOT_FOUND",
      );
    }

    // 合并凭证必须来自「旧账号绑定的邮箱」：调用方负责校验验证码，但这里也要拒绝无邮箱的旧号，
    // 否则直接调用本函数就能绕过归属验证。
    if (!old.email) {
      throw new UserMergeError(
        "旧账号没有绑定邮箱，无法验证归属，请联系管理员处理",
        "EMAIL_MISMATCH",
      );
    }

    // 旧账号必须只属于当前墙：合并只迁本墙数据，却会做全局重定向。
    if (!await isMergeScopeSingleTenant(tx, { oldQqUin: input.oldQqUin, tenantId: input.tenantId })) {
      throw new UserMergeError(
        "这个旧账号还属于其他校园墙，无法自助合并，请联系系统运维处理",
        "EMAIL_MISMATCH",
      );
    }

    // ── 稿件：只迁当前墙 ──
    const postResult = await tx.post.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });

    // ── 成员身份：同墙若已有目标账号的 membership，会撞 (tenantId,userId) unique，
    // 这时删掉旧那条而不是 update。 ──
    const [oldMembership, targetMembership] = await Promise.all([
      tx.tenantMembership.findFirst({ where: { tenantId: input.tenantId, userId: old.id }, select: { id: true, role: true } }),
      tx.tenantMembership.findFirst({ where: { tenantId: input.tenantId, userId: target.id }, select: { id: true, role: true } }),
    ]);
    let migratedMemberships = 0;
    if (oldMembership) {
      if (targetMembership) {
        await tx.tenantMembership.delete({ where: { id: oldMembership.id } });
      } else {
        await tx.tenantMembership.update({ where: { id: oldMembership.id }, data: { userId: target.id } });
        migratedMemberships = 1;
      }
    }

    // ── 关注：同 (postId,userId) 可能重复，先删冲突再迁移 ──
    const oldFollows = await tx.postFollow.findMany({ where: { userId: old.id }, select: { postId: true } });
    if (oldFollows.length > 0) {
      const targetFollows = await tx.postFollow.findMany({
        where: { userId: target.id, postId: { in: oldFollows.map((f) => f.postId) } },
        select: { postId: true },
      });
      const dupes = new Set(targetFollows.map((f) => f.postId));
      const movable = oldFollows.filter((f) => !dupes.has(f.postId)).map((f) => f.postId);
      if (dupes.size > 0) {
        await tx.postFollow.deleteMany({ where: { userId: old.id, postId: { in: [...dupes] } } });
      }
      if (movable.length > 0) {
        await tx.postFollow.updateMany({ where: { userId: old.id, postId: { in: movable } }, data: { userId: target.id } });
      }
    }

    // ── 其余按墙归属的创作记录：直接改作者，没有 unique 冲突风险 ──
    await tx.tenantFeedback.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    await tx.userGraduation.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    await tx.tenantBroadcast.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    await tx.campaign.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    // 投票有 (campaignId, voterId) unique：同样先删冲突。
    const oldVotes = await tx.campaignVote.findMany({ where: { voterId: old.id }, select: { campaignId: true } });
    if (oldVotes.length > 0) {
      const targetVotes = await tx.campaignVote.findMany({
        where: { voterId: target.id, campaignId: { in: oldVotes.map((v) => v.campaignId) } },
        select: { campaignId: true },
      });
      const dupCampaigns = new Set(targetVotes.map((v) => v.campaignId));
      if (dupCampaigns.size > 0) {
        await tx.campaignVote.deleteMany({ where: { voterId: old.id, campaignId: { in: [...dupCampaigns] } } });
      }
      const movableVotes = oldVotes.filter((v) => !dupCampaigns.has(v.campaignId)).map((v) => v.campaignId);
      if (movableVotes.length > 0) {
        await tx.campaignVote.updateMany({ where: { voterId: old.id, campaignId: { in: movableVotes } }, data: { voterId: target.id } });
      }
    }
    // 第三方身份的唯一键是 (provider, providerUserId)：同 provider 下不同账号可以共存，
    // 所以只能删「两个字段都相同」的重复行，其余照常迁移。
    const oldIdentities = await tx.oAuthIdentity.findMany({
      where: { userId: old.id },
      select: { id: true, provider: true, providerUserId: true },
    });
    if (oldIdentities.length > 0) {
      const targetIdentities = await tx.oAuthIdentity.findMany({
        where: { userId: target.id },
        select: { provider: true, providerUserId: true },
      });
      const identityKey = (i: { provider: string; providerUserId: string }) => `${i.provider}\u0001${i.providerUserId}`;
      const dupKeys = new Set(targetIdentities.map(identityKey));
      const duplicateIds = oldIdentities.filter((i) => dupKeys.has(identityKey(i))).map((i) => i.id);
      const movableIdentities = oldIdentities.filter((i) => !dupKeys.has(identityKey(i))).map((i) => i.id);
      if (duplicateIds.length > 0) {
        await tx.oAuthIdentity.deleteMany({ where: { id: { in: duplicateIds } } });
      }
      if (movableIdentities.length > 0) {
        await tx.oAuthIdentity.updateMany({ where: { id: { in: movableIdentities } }, data: { userId: target.id } });
      }
    }

    // 旧号停用：清空登录会话并打标记。
    // 用条件更新声明「这个旧号归我合并」：并发下只有一个事务能成功，
    // 否则两个请求都能通过前置检查，后提交的会覆盖先前的 mergedIntoUserId。
    // 邮箱是 unique：旧号若占用着与新号相同的邮箱，停用后必须释放，否则新号将来改绑会撞约束。
    await tx.accountSession.deleteMany({ where: { userId: old.id } });
    const claimed = await tx.user.updateMany({
      where: { id: old.id, mergedAt: null },
      data: {
        mergedAt: new Date(),
        mergedIntoUserId: target.id,
        ...(old.email !== null && old.email === target.email ? { email: null } : {}),
      },
    });
    if (claimed.count !== 1) {
      // 声明失败 → 抛错让整个事务回滚（包括已迁移的稿件/身份）。
      throw new UserMergeError("这个旧账号刚刚已被合并，请刷新后重试", "ALREADY_MERGED");
    }

    const merge = await tx.userMerge.create({
      data: {
        tenantId: input.tenantId,
        oldUserId: old.id,
        newUserId: target.id,
        oldQqUin: old.qqUin,
        newQqUin: target.qqUin,
        oldEmail: old.email,
        migratedPosts: postResult.count,
        migratedMemberships,
      },
    });

    await writeAuditLog({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "user.merge",
      targetType: "user",
      targetId: target.id,
      detail: {
        mergeId: merge.id,
        oldUserId: old.id,
        oldQqUin: old.qqUin.toString(),
        newUserId: target.id,
        newQqUin: target.qqUin.toString(),
        migratedPosts: postResult.count,
        migratedMemberships,
      },
    }, tx);

    return {
      mergeId: merge.id,
      migratedPosts: postResult.count,
      migratedMemberships,
      oldQqUin: old.qqUin.toString(),
    };
  }, { maxWait: 15_000, timeout: 60_000 });
}

/**
 * 合并链的硬上限：只用于防御异常数据（环或畸形链），正常合并不该接近这个数。
 * 早期实现是 5，长链账号会被判成「未合并」而登录到旧号，所以现在放宽到 32。
 */
const MAX_MERGE_HOPS = 32;

/**
 * 把「可能是被合并旧号」的账号解析到最终主账号。
 *
 * 合并后旧号仍占用原 QQ 号与邮箱（用于审计与反查），所以用旧凭据登录会先查到旧号。
 * 这里沿 `mergedIntoUserId` 一直往上找到真正的主账号；主账号没被合并时原样返回。
 *
 * 用**环检测**而不是固定跳数来终止：多级合并（A→B→C→…）必须一路追到底，
 * 否则用户会被登进一个已被停用的中间账号。只有真正成环时才放弃。
 *
 * 返回 `redirectedFrom` 让调用方能提示「该账号已合并到新账号」。
 */
export async function resolveActiveAccount(
  client: typeof prisma | Prisma.TransactionClient,
  user: { id: string; mergedAt: Date | null; mergedIntoUserId: string | null },
): Promise<{ userId: string; redirectedFrom: string | null }> {
  if (user.mergedAt === null || !user.mergedIntoUserId) {
    return { userId: user.id, redirectedFrom: null };
  }
  const firstOldId = user.id;
  const visited = new Set<string>([user.id]);
  let currentId = user.mergedIntoUserId;
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
    const next = await client.user.findUnique({
      where: { id: currentId },
      select: { id: true, mergedAt: true, mergedIntoUserId: true },
    });
    if (!next) {
      // 目标账号被删掉了：退回旧号本身，避免把用户彻底挡在门外。
      return { userId: firstOldId, redirectedFrom: null };
    }
    if (next.mergedAt === null || !next.mergedIntoUserId) {
      return { userId: next.id, redirectedFrom: firstOldId };
    }
    // 成环（或跳数超限）：放弃解析，让上层按「未合并」处理，
    // 而不是登进一个未校验的中间账号。
    if (visited.has(next.id)) {
      return { userId: firstOldId, redirectedFrom: null };
    }
    visited.add(next.id);
    currentId = next.mergedIntoUserId;
  }
  return { userId: firstOldId, redirectedFrom: null };
}

/**
 * 登录后是否需要提示「绑定之前的账号」。 *
 * 用户的规则：管理员切换运营模式后，用户首次登录时提示；重复切换不再提示；
 * 已经绑定过邮箱、或已合并过的账号不再提示。
 *
 * 这里用 `User.email`（已绑邮箱即视为无需提示）与 `User.mergedAt` 推导，
 * 避免再加一张「已提示过」的表：绑过邮箱的账号本来就不会走「Bot 建号」路径。
 */
export function shouldPromptAccountMerge(user: { email: string | null; mergedAt: Date | null }): boolean {
  return user.email === null && user.mergedAt === null;
}
