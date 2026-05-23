import { Buffer } from "node:buffer";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { createS3Client } from "@campux/integrations";
import { Prisma } from "@campux/db";
import {
  BotWorkflowError,
  findEnabledBot,
  qzoneCookieDomain,
  refreshQZoneCookiesForBot,
  refreshQZoneCookiesViaBot,
  registerUserViaBot,
  requireBotTenantRole,
  reviewPostViaBot,
  resetPasswordViaBot,
} from "../lib/bot-workflows";
import { writeAuditLog } from "../lib/audit";
import { compressImageBuffer, deleteAttachmentObjects, uploadAttachmentBytes, type PostAttachment } from "../lib/attachments";
import { findActiveBan, hasTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { extractOneBotImageSegments, extractOneBotPlainText, isPrivatePostCancelText, isPrivatePostFinishText, parsePrivatePostModeText, parsePrivatePostStartText, parsePrivatePostImageDecisionText } from "../lib/private-posting";
import { readTenantImageCompression, readTenantPendingPostLimit } from "../lib/tenant-metadata";
import type { RuntimeQueue } from "./queue";
import { checkAndUpdateQZoneSession } from "../lib/qzone-cookies";
import { pollQZoneQrLogin, startQZoneQrLogin } from "../lib/qzone-login";
import { resumePublishAttemptsWaitingForCookies } from "./publishing";
import { selectReviewNotificationBot } from "./notification-routing";

type OneBotConnection = {
  socket: WebSocketLike;
  botAccountId: string;
  tenantId: string;
  selfId: string | null;
};

type WebSocketLike = {
  readyState: number;
  send(data: string, callback?: (error?: Error) => void): void;
  close?(code?: number, reason?: string): void;
  on(event: "message", listener: (data: { toString(): string }) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

type PendingAction = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: Timer;
};

type OneBotActionResponse = {
  echo?: string;
  status?: string;
  retcode?: number;
  data?: unknown;
  message?: string;
  wording?: string;
};

type PrivatePostDraft = {
  tenantId: string;
  text: string;
  anonymous: boolean;
  attachments: PostAttachment[];
  uploadedKeys: string[];
  updatedAt: number;
  awaitingImageDecision?: boolean;
};

type PrivatePostPendingMode = {
  tenantId: string;
  text: string;
  attachments: PostAttachment[];
  uploadedKeys: string[];
  updatedAt: number;
};

type OneBotMessageEvent = {
  post_type?: string;
  message_type?: "private" | "group";
  self_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  message?: unknown;
  raw_message?: string;
  sender?: {
    nickname?: string;
    card?: string;
  };
};

const privateHelp = [
  "可以发送 #注册账号，用当前 QQ 注册本校园墙账号。",
  "可以发送 #重置密码，重置你的登录密码。",
  "想投稿时先发 #投稿 正文，然后回复 #匿名 或 #实名；后面只发图片，准备好了再发 #结束投稿。",
  "不想继续时发 #取消投稿，就能取消这次投稿。",
].join("\n");

const reviewHelp = [
  "审核命令：",
  "#通过 <稿件id>",
  "#拒绝 <理由> <稿件id>",
  "#重发 <稿件id>",
  "#登录 或 #刷新qzone cookies",
  "#扫码登录",
].join("\n");

function readRecallReason(comment: string | undefined): string | null {
  const prefix = "用户申请撤回：";
  if (!comment?.startsWith(prefix)) {
    return null;
  }
  return comment.slice(prefix.length).trim() || null;
}

export class OneBotRuntime {
  private readonly connections = new Set<OneBotConnection>();
  private readonly pendingActions = new Map<string, PendingAction>();
  private readonly privateAutoReplyAt = new Map<string, number>();
  private readonly privatePostPendingModes = new Map<string, PrivatePostPendingMode>();
  private readonly privatePostDrafts = new Map<string, PrivatePostDraft>();

  constructor(
    private readonly queue: RuntimeQueue,
    private readonly logger: FastifyBaseLogger,
    private readonly config?: CampuxConfig,
  ) {}

  async handleConnection(socket: WebSocketLike, request: { headers: Record<string, string | string[] | undefined>; url?: string }) {
    const auth = await this.authenticateConnection(request);
    if (!auth) {
      socket.close?.(1008, "invalid onebot token");
      this.logger.warn("onebot websocket rejected");
      return;
    }
    const connection: OneBotConnection = {
      socket,
      botAccountId: auth.id,
      tenantId: auth.tenantId,
      selfId: auth.qqUin.toString(),
    };
    this.connections.add(connection);
    this.markBotSeen(connection).catch((error) => this.logger.warn({ error, selfId: connection.selfId }, "failed to mark onebot bot seen"));

    socket.on("message", (data) => {
      this.handleSocketMessage(connection, data.toString()).catch((error) => {
        this.logger.error({ error }, "onebot message handling failed");
      });
    });
    socket.on("close", () => {
      this.connections.delete(connection);
    });
    socket.on("error", (error) => {
      this.logger.warn({ error }, "onebot websocket error");
    });

    this.logger.info({ botAccountId: connection.botAccountId, tenantId: connection.tenantId, selfId: connection.selfId }, "onebot websocket connected");
  }

  async notifyNewPost(postId: string) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        author: true,
        tenant: true,
      },
    });
    if (!post) {
      return;
    }

    const bot = await this.findTenantReviewNotificationBot(post.tenantId);
    if (!bot?.reviewGroupId) {
      return;
    }

    const attachments = Array.isArray(post.attachments) ? post.attachments : [];
    const imageCount = attachments.filter((a: any) => a.kind === "image").length;
    const attachmentSummary = imageCount > 0
      ? `图片：${imageCount} 张`
      : "图片：0 张";
    const lines = [
      `${post.tenant.name} 新稿件`,
      `编号：#${post.displayId}`,
      `投稿人：${post.anonymous ? `匿名（QQ ${post.author.qqUin.toString()}）` : `${post.author.displayName ?? "未命名"}（QQ ${post.author.qqUin.toString()}）`}`,
      attachmentSummary,
      "",
      post.text,
      "",
      `通过：#通过 ${post.displayId}`,
      `拒绝：#拒绝 <理由> ${post.displayId}`,
    ];
    const attachmentSegments = await this.loadPostAttachmentSegments(post.attachments);
    const message =
      attachmentSegments.length > 0
        ? [
            {
              type: "text",
              data: {
                text: lines.join("\n"),
              },
            },
            ...attachmentSegments,
          ]
        : lines.join("\n");

    await this.sendGroupMessage(bot.qqUin.toString(), bot.reviewGroupId, message).catch((error) => {
      this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify review group");
    });
  }

  async notifyPostCancelled(postId: string) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        tenant: true,
      },
    });
    if (!post) {
      return;
    }
    await this.sendTenantReviewNotification(post.tenantId, `稿件已取消：#${post.displayId}`);
  }

  async notifyPostRecallRequested(postId: string) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        author: true,
        logs: {
          where: {
            oldStatus: "published",
            newStatus: "pending_recall",
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
    });
    if (!post) {
      return;
    }
    const lines = [
      `稿件申请撤回：#${post.displayId}`,
      `申请人：${post.author.displayName ?? "未命名用户"}（QQ ${post.author.qqUin.toString()}）`,
      `理由：${readRecallReason(post.logs[0]?.comment) ?? "未填写"}`,
      "审核员或管理员可在稿件页面同意撤回；同意后系统会把每个 QZone 发布目标设置为仅自己可见。",
    ];
    await this.sendTenantReviewNotification(post.tenantId, lines.join("\n"));
  }

  async notifyPostRecalled(postId: string, targetCount: number, opts?: { skipAuthor?: boolean }) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        author: true,
      },
    });
    if (!post) {
      return;
    }
    const groupSuffix = opts?.skipAuthor ? "\n（静默撤回，未通知作者）" : "";
    await this.sendTenantReviewNotification(post.tenantId, `稿件已撤回：#${post.displayId}\n已处理发布目标：${targetCount} 个${groupSuffix}`);

    if (opts?.skipAuthor) {
      return;
    }

    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId: post.tenantId,
        enabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    for (const bot of bots) {
      await this.sendPrivateMessage(bot.qqUin.toString(), post.author.qqUin, `您的稿件 #${post.displayId} 已撤回。`).catch((error) => {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), userQqUin: post.author.qqUin.toString(), postId }, "failed to notify post recalled");
      });
    }
  }

  async notifyPostRecallRejected(postId: string, reason: string) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        author: true,
      },
    });
    if (!post) {
      return;
    }
    await this.sendTenantReviewNotification(post.tenantId, `撤回申请已拒绝：#${post.displayId}\n状态已恢复为已发表。\n理由：${reason}`);

    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId: post.tenantId,
        enabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    for (const bot of bots) {
      await this.sendPrivateMessage(bot.qqUin.toString(), post.author.qqUin, `您的稿件 #${post.displayId} 撤回申请未通过。\n理由：${reason}`).catch((error) => {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), userQqUin: post.author.qqUin.toString(), postId }, "failed to notify post recall rejected");
      });
    }
  }

  async notifyPostRecallFailed(postId: string, results: Array<{ targetName: string; qzoneTid: string | null; ok: boolean; message: string }>) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
    });
    if (!post) {
      return;
    }
    const failed = results.filter((result) => !result.ok);
    const lines = [
      `稿件撤回失败：#${post.displayId}`,
      ...failed.map((result) => `${result.targetName}${result.qzoneTid ? ` / ${result.qzoneTid}` : ""}：${result.message}`),
    ];
    await this.sendTenantReviewNotification(post.tenantId, lines.join("\n"));
  }

  async notifyReviewResult(postId: string, status: "approved" | "rejected", comment?: string | null) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        author: true,
      },
    });
    if (!post) {
      return;
    }

    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId: post.tenantId,
        enabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    const message = status === "approved"
      ? `您的稿件 #${post.displayId} 已通过审核`
      : `您的稿件 #${post.displayId} 未通过审核，原因：${comment?.trim() || "审核拒绝"}`;

    for (const bot of bots) {
      await this.sendPrivateMessage(bot.qqUin.toString(), post.author.qqUin, message).catch((error) => {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), userQqUin: post.author.qqUin.toString(), postId }, "failed to notify review result");
      });
    }
  }

  async notifyPublishSucceeded(postId: string, targetId: string, externalId: string) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        tenant: true,
      },
    });
    const target = await prisma.publishTarget.findUnique({
      where: {
        id: targetId,
      },
      include: {
        botAccount: true,
      },
    });
    if (!post) {
      return;
    }
    if (!target) {
      await this.sendTenantReviewNotification(post.tenantId, `已成功发表：#${post.displayId}\n外部 ID：${externalId}`);
      return;
    }
    await this.sendBotReviewGroupMessage(target.botAccount, `已成功发表：#${post.displayId}\n目标：${target.displayName}\n外部 ID：${externalId}`, "failed to notify publish succeeded");
  }

  async notifyPublishFailed(postId: string, targetId: string, message: string, options?: { needsLogin?: boolean; nextRunAt?: Date | null }) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        tenant: true,
      },
    });
    const target = await prisma.publishTarget.findUnique({
      where: {
        id: targetId,
      },
      include: {
        botAccount: true,
      },
    });
    if (!post) {
      return;
    }
    const lines = [
      options?.needsLogin ? `发表失败：#${post.displayId}，QZone cookies 未登录或已失效。` : `发表失败：#${post.displayId}`,
      target ? `目标：${target.displayName}（${target.botAccount.displayName} / QQ ${target.botAccount.qqUin.toString()}）` : null,
      `原因：${message}`,
      options?.needsLogin ? "请在群内发送 #登录 或 #扫码登录 重新登录后，再重试发布。" : null,
      options?.nextRunAt ? `下次重试：${formatDateTime(options.nextRunAt)}` : null,
    ].filter((line): line is string => Boolean(line));
    if (target) {
      await this.sendBotReviewGroupMessage(target.botAccount, lines.join("\n"), "failed to notify publish failed");
    } else {
      await this.sendTenantReviewNotification(post.tenantId, lines.join("\n"));
    }
  }

  async notifyPublishWaitingForCookies(postId: string, targetId: string, message: string) {
    const post = await prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        tenant: true,
      },
    });
    const target = await prisma.publishTarget.findUnique({
      where: {
        id: targetId,
      },
      include: {
        botAccount: true,
      },
    });
    if (!post) {
      return;
    }
    const lines = [
      `发表等待：#${post.displayId}`,
      target ? `目标：${target.displayName}（${target.botAccount.displayName} / QQ ${target.botAccount.qqUin.toString()}）` : null,
      `原因：${message}`,
      "系统不会继续发布这条稿件，直到 QZone cookies 检测可用；重新登录或自动刷新成功后会自动恢复队列。",
    ].filter((line): line is string => Boolean(line));
    if (target) {
      await this.sendBotReviewGroupMessage(target.botAccount, lines.join("\n"), "failed to notify publish waiting for cookies");
    } else {
      await this.sendTenantReviewNotification(post.tenantId, lines.join("\n"));
    }
  }

  async notifyQZoneCookiesInvalid(botAccountId: string, message: string, options?: { autoRefreshError?: string | null }) {
    const bot = await prisma.botAccount.findUnique({
      where: {
        id: botAccountId,
      },
    });
    if (!bot || !bot.reviewGroupId) {
      return;
    }
    await this.sendGroupMessage(
      bot.qqUin.toString(),
      bot.reviewGroupId,
      [
        options?.autoRefreshError
          ? "QQ空间cookies已失效，协议自动刷新也失败了，请 @ 并发送 #登录 或 #扫码登录 命令进行重新登录。"
          : "QQ空间cookies已失效，请 @ 并发送 #登录 或 #扫码登录 命令进行重新登录。",
        `墙号：${bot.displayName} / QQ ${bot.qqUin.toString()}`,
        `检测结果：${message}`,
        options?.autoRefreshError ? `自动刷新失败：${options.autoRefreshError}` : null,
      ].filter((line): line is string => Boolean(line)).join("\n"),
    ).catch((error) => {
      this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify qzone cookies invalid");
    });
  }

  async refreshQZoneCookiesByProtocol(botAccountId: string, reason: "heartbeat_invalid" | "publish_login_required" | "publish_preflight_invalid") {
    const bot = await prisma.botAccount.findUnique({
      where: {
        id: botAccountId,
      },
    });
    if (!bot || !bot.enabled) {
      throw new BotWorkflowError("Bot 未绑定校园墙", 404);
    }

    try {
      const rawCookies = await this.getQZoneCookiesFromProtocol(bot.qqUin.toString());
      const result = await refreshQZoneCookiesForBot({
        botQqUin: bot.qqUin.toString(),
        rawCookies,
        actorId: null,
        action: "bot.qzone.cookies.auto_refresh",
        detail: {
          reason,
          source: "protocol",
          reviewGroupId: bot.reviewGroupId,
        },
      });
      const checked = await checkAndUpdateQZoneSession(result.session.id);
      if (checked?.healthStatus === "invalid") {
        throw new BotWorkflowError(`协议自动刷新后 cookies 仍不可用：${checked.healthMessage ?? "未知错误"}`, 502);
      }
      await this.notifyQZoneCookiesAutoRefreshed(bot.id, reason, result.cookieNames.length, checked?.healthMessage ?? null);
      await this.resumeWaitingPublishAttemptsForBot(bot.id);
      return result;
    } catch (error) {
      await writeAuditLog({
        tenantId: bot.tenantId,
        actorId: null,
        action: "bot.qzone.cookies.auto_refresh_failed",
        targetType: "bot_account",
        targetId: bot.id,
        detail: {
          reason,
          source: "protocol",
          error: toErrorMessage(error),
        },
      });
      throw error;
    }
  }

  private async notifyQZoneCookiesAutoRefreshed(botAccountId: string, reason: string, cookieCount: number, healthMessage: string | null) {
    const bot = await prisma.botAccount.findUnique({
      where: {
        id: botAccountId,
      },
    });
    if (!bot || !bot.reviewGroupId) {
      return;
    }
    await this.sendGroupMessage(
      bot.qqUin.toString(),
      bot.reviewGroupId,
      [
        "QZone cookies 已通过协议自动刷新。",
        `墙号：${bot.displayName} / QQ ${bot.qqUin.toString()}`,
        `触发原因：${formatQZoneAutoRefreshReason(reason)}`,
        `刷新结果：${cookieCount} 项 cookies`,
        healthMessage ? `检测结果：${healthMessage}` : null,
      ].filter((line): line is string => Boolean(line)).join("\n"),
    ).catch((error) => {
      this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify qzone cookies auto refresh");
    });
  }

  async resumeWaitingPublishAttemptsForBot(botAccountId: string) {
    const count = await resumePublishAttemptsWaitingForCookies(this.queue, botAccountId, this.logger);
    if (count <= 0) {
      return count;
    }
    const bot = await prisma.botAccount.findUnique({
      where: {
        id: botAccountId,
      },
    });
    if (bot?.reviewGroupId) {
      await this.sendGroupMessage(bot.qqUin.toString(), bot.reviewGroupId, `已恢复 ${count} 个因 QZone cookies 不可用而暂停的发布任务。`).catch((error) => {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify waiting publish attempts resumed");
      });
    }
    return count;
  }

  getBotConnectionStatus(botQqUin: string) {
    const connections = Array.from(this.connections).filter((connection) => connection.selfId === botQqUin && connection.socket.readyState === 1);
    return {
      online: connections.length > 0,
      connectionCount: connections.length,
    };
  }

  async sendPrivateMessage(botQqUin: string, userQqUin: string | bigint, message: string) {
    await this.callAction(botQqUin, "send_private_msg", {
      user_id: Number(userQqUin),
      message,
    });
  }

  async sendGroupMessage(botQqUin: string, groupId: string | bigint, message: unknown) {
    await this.callAction(botQqUin, "send_group_msg", {
      group_id: Number(groupId),
      message,
    });
  }

  async sendTenantReviewNotification(tenantId: string, message: unknown) {
    const bot = await this.findTenantReviewNotificationBot(tenantId);
    if (!bot) {
      return;
    }
    await this.sendBotReviewGroupMessage(bot, message, "failed to send tenant review notification");
  }

  private async findTenantReviewNotificationBot(tenantId: string) {
    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId,
        enabled: true,
        reviewGroupId: {
          not: null,
        },
        reviewNotificationEnabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    return selectReviewNotificationBot(bots);
  }

  private async sendBotReviewGroupMessage(
    bot: { qqUin: bigint; displayName?: string; reviewGroupId: string | null },
    message: unknown,
    logMessage: string,
  ) {
    if (!bot.reviewGroupId) {
      return;
    }
    await this.sendGroupMessage(bot.qqUin.toString(), bot.reviewGroupId, message).catch((error) => {
      this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, logMessage);
    });
  }

  async callAction(botQqUin: string, action: string, params: Record<string, unknown>, timeoutMs = 8_000) {
    const connection = this.findConnection(botQqUin);
    if (!connection) {
      throw new BotWorkflowError(`Bot ${botQqUin} 的 OneBot 连接不在线`, 503);
    }

    const echo = `campux:${crypto.randomUUID()}`;
    const payload = {
      action,
      params,
      echo,
    };

    const response = await new Promise<OneBotActionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(echo);
        reject(new BotWorkflowError(`OneBot 动作 ${action} 等待响应超时`, 504));
      }, timeoutMs);
      this.pendingActions.set(echo, { resolve: resolve as (value: unknown) => void, reject, timer });
      connection.socket.send(JSON.stringify(payload), (error) => {
        if (error) {
          clearTimeout(timer);
          this.pendingActions.delete(echo);
          reject(error);
        }
      });
    });

    if (response.status && response.status !== "ok") {
      throw new BotWorkflowError(response.message || response.wording || `OneBot 动作 ${action} 执行失败`, 502);
    }
    if (typeof response.retcode === "number" && response.retcode !== 0) {
      throw new BotWorkflowError(response.message || response.wording || `OneBot 动作 ${action} 返回 ${response.retcode}`, 502);
    }

    return response.data;
  }

  private async handleSocketMessage(connection: OneBotConnection, payload: string) {
    const event = JSON.parse(payload) as OneBotMessageEvent | OneBotActionResponse;
    if ("echo" in event && event.echo) {
      this.resolvePendingAction(event);
      return;
    }

    const selfId = normalizeId((event as OneBotMessageEvent).self_id);
    if (selfId && connection.selfId !== selfId) {
      this.logger.warn({ expectedSelfId: connection.selfId, actualSelfId: selfId }, "onebot event self_id mismatch");
      connection.socket.close?.(1008, "self_id mismatch");
      this.connections.delete(connection);
      return;
    }

    if ((event as OneBotMessageEvent).post_type !== "message") {
      return;
    }

    const messageEvent = event as OneBotMessageEvent;
    if (messageEvent.message_type === "private") {
      await this.handlePrivateMessage(messageEvent);
    }
    if (messageEvent.message_type === "group") {
      await this.handleGroupMessage(messageEvent);
    }
  }

  private async handlePrivateMessage(event: OneBotMessageEvent) {
    const botQqUin = normalizeId(event.self_id);
    const userQqUin = normalizeId(event.user_id);
    if (!botQqUin || !userQqUin || botQqUin === userQqUin) {
      return;
    }

    try {
      const bot = await findEnabledBot(botQqUin);
      const plainText = extractOneBotPlainText(event.message, event.raw_message).trim();
      const startBody = parsePrivatePostStartText(plainText);
      if (startBody !== null) {
        await this.startPrivatePostDraft({
          bot,
          botQqUin,
          userQqUin,
          event,
          body: startBody,
        });
        return;
      }

      if (isPrivatePostCancelText(plainText)) {
        await this.cancelPrivatePostDraft({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      const draftKey = this.getPrivatePostDraftKey(botQqUin, userQqUin);
      const pendingMode = this.privatePostPendingModes.get(draftKey);
      if (pendingMode) {
        const selection = parsePrivatePostModeText(plainText);
        if (selection) {
          await this.selectPrivatePostMode({
            bot,
            botQqUin,
            userQqUin,
            anonymous: selection.anonymous,
          });
          return;
        }

        await this.sendPrivateMessage(botQqUin, userQqUin, "这次投稿还在等你选匿名还是实名，回复 #匿名 或 #实名；不想继续可以发 #取消投稿。");
        return;
      }

      if (isPrivatePostFinishText(plainText)) {
        await this.finishPrivatePostDraft({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      const draft = this.privatePostDrafts.get(draftKey);
      if (draft) {
          const draftText = extractOneBotPlainText(event.message, event.raw_message).trim();
          const imageSegments = extractOneBotImageSegments(event.message);

          if (draft.awaitingImageDecision) {
            const decision = parsePrivatePostImageDecisionText(draftText);
            if (!decision) {
              await this.sendPrivateMessage(botQqUin, userQqUin, "现在请回复 #添加图片 / #是 或 #不添加图片 / #否；不想继续可以发 #取消投稿。");
              return;
            }

            draft.awaitingImageDecision = false;
            if (!decision.addImages) {
              await this.sendPrivateMessage(botQqUin, userQqUin, this.formatPrivatePostDraftSummary(draft.text, draft.attachments.length, draft.anonymous));
              return;
            }

            await this.sendPrivateMessage(botQqUin, userQqUin, "好的，请开始发送图片，发完图片后再发 #结束投稿 提交稿件；发送 #取消投稿 放弃。");
            return;
          }

          if (draftText.length > 0) {
            await this.sendPrivateMessage(botQqUin, userQqUin, "收到文字啦，但这一步只收图片。继续发图，或者直接发 #结束投稿 提交稿件。");
            return;
          }

          if (imageSegments.length > 0) {
            await this.appendPrivatePostDraftImages({
              bot,
              botQqUin,
              userQqUin,
              event,
            });
            return;
          }

          return;
      }

      const command = parsePrivateCommand(plainText);
      if (!command) {
        if (this.shouldSendPrivateAutoReply(bot.id, userQqUin, bot.userMessageReplyCooldownSeconds)) {
          await this.sendPrivateMessage(botQqUin, userQqUin, bot.userMessageReply || privateHelp).catch(() => undefined);
        }
        return;
      }

      if (command.name === "注册账号") {
        const result = await registerUserViaBot({
          botQqUin,
          userQqUin,
          displayName: event.sender?.card || event.sender?.nickname || null,
        });
        const message = result.password
          ? `注册成功，初始密码：\n${result.password}`
          : result.alreadyHadTenantAccess
            ? "这个 QQ 已经注册过啦。如果忘记密码，可以发 #重置密码。"
            : "已经帮你开通本校园墙的访问权限了，登录密码沿用原账号。忘记密码就发 #重置密码。";
        await this.sendPrivateMessage(botQqUin, userQqUin, message);
        return;
      }
      if (command.name === "重置密码") {
        const result = await resetPasswordViaBot({
          botQqUin,
          userQqUin,
        });
        await this.sendPrivateMessage(botQqUin, userQqUin, `已经重置好啦，新密码：\n${result.password}`);
        return;
      }

      await this.sendPrivateMessage(botQqUin, userQqUin, bot.userMessageReply || privateHelp);
    } catch (error) {
      await this.sendPrivateMessage(botQqUin, userQqUin, toErrorMessage(error)).catch(() => undefined);
    }
  }

  private getPrivatePostDraftKey(botQqUin: string, userQqUin: string) {
    return `${botQqUin}:${userQqUin}`;
  }

  private async startPrivatePostDraft({
    bot,
    botQqUin,
    userQqUin,
    event,
    body,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
    event: OneBotMessageEvent;
    body: string;
  }) {
    await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);

    const draftKey = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    const staged = await this.stagePrivatePostAttachments(bot, event);
    if (staged.attachments.length > 9) {
      await this.clearStagedPrivatePostAttachments(staged.uploadedKeys);
      throw new BotWorkflowError("最多 9 张图片", 400);
    }

    await this.clearPrivatePostPending(draftKey);
    await this.clearPrivatePostDraft(draftKey);
    const text = body.trim();
    const attachments = staged.attachments;
    this.privatePostPendingModes.set(draftKey, {
      tenantId: bot.tenantId,
      text,
      attachments,
      uploadedKeys: staged.uploadedKeys,
      updatedAt: Date.now(),
    });

    const summary = this.formatPrivatePostPendingSummary(text, attachments.length);
    await this.sendPrivateMessage(botQqUin, userQqUin, summary);
  }

  private async appendPrivatePostDraftImages({
    bot,
    botQqUin,
    userQqUin,
    event,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
    event: OneBotMessageEvent;
  }) {
    await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);

    const draftKey = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    const pending = this.privatePostPendingModes.get(draftKey);
    if (pending) {
      await this.clearPrivatePostPending(draftKey);
      await this.sendPrivateMessage(botQqUin, userQqUin, "好，已经帮你取消这次投稿了。");
      return;
    }

    const draft = this.privatePostDrafts.get(draftKey);
    if (!draft) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "还没有进行中的投稿，先发 #投稿 正文 吧。");
      return;
    }

    const staged = await this.stagePrivatePostAttachments(bot, event);
    if (staged.attachments.length === 0) {
      return;
    }

    if (draft.attachments.length + staged.attachments.length > 9) {
      await this.clearStagedPrivatePostAttachments(staged.uploadedKeys);
      await this.sendPrivateMessage(botQqUin, userQqUin, "图片最多 9 张，请删减后再继续发送。");
      return;
    }

    draft.attachments.push(...staged.attachments);
    draft.uploadedKeys.push(...staged.uploadedKeys);
    draft.updatedAt = Date.now();

    await this.sendPrivateMessage(botQqUin, userQqUin, this.formatPrivatePostDraftSummary(draft.text, draft.attachments.length, draft.anonymous));
  }

  private async cancelPrivatePostDraft({
    bot,
    botQqUin,
    userQqUin,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
  }) {
    await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);

    const draftKey = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    const pending = this.privatePostPendingModes.get(draftKey);
    if (pending) {
      await this.clearPrivatePostPending(draftKey);
      await this.sendPrivateMessage(botQqUin, userQqUin, "好，已经帮你取消这次投稿了。");
      return;
    }

    const draft = this.privatePostDrafts.get(draftKey);
    if (!draft) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "还没有进行中的投稿。");
      return;
    }

    await this.clearPrivatePostDraft(draftKey);
    await this.sendPrivateMessage(botQqUin, userQqUin, "好，已经帮你取消这次投稿了。");
  }

  private async finishPrivatePostDraft({
    bot,
    botQqUin,
    userQqUin,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
  }) {
    await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);

    const draftKey = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    const draft = this.privatePostDrafts.get(draftKey);
    if (!draft) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "还没有进行中的投稿，先发 #投稿 正文 吧。");
      return;
    }

    const text = draft.text.trim();
    if (!text) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "正文还是空的，先发 #投稿 正文，再发 #结束投稿 吧。");
      return;
    }
    if (text.length > 1_000) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "正文有点长了，先精简到 1000 字以内，再发 #结束投稿 吧。");
      return;
    }

    const post = await this.createPostFromPrivateDraft(bot, userQqUin, draft).catch(async (error) => {
      if (error instanceof BotWorkflowError) {
        await this.sendPrivateMessage(botQqUin, userQqUin, error.message).catch(() => undefined);
        return null;
      }
      throw error;
    });
    if (!post) {
      return;
    }

    this.privatePostDrafts.delete(draftKey);
    await this.sendPrivateMessage(botQqUin, userQqUin, `投稿成功，稿件编号 #${post.displayId}，已提交审核。`);
    this.notifyNewPost(post.id).catch((error) => {
      this.logger.warn({ error, postId: post.id }, "failed to notify review group from private post");
    });
  }

  private async ensurePrivatePostingAllowed(tenantId: string, userQqUin: string) {
    const operator = await prisma.user.findUnique({
      where: {
        qqUin: BigInt(userQqUin),
      },
      include: {
        memberships: true,
      },
    });
    const membership = operator?.memberships.find((item) => item.tenantId === tenantId);
    if (!operator || !membership || !hasTenantRole(membership.role, "submitter")) {
      throw new BotWorkflowError("这个 QQ 还没有注册本校园墙，请先发 #注册账号。", 404);
    }

    const activeBan = await findActiveBan(tenantId, operator.id);
    if (activeBan) {
      throw new BotWorkflowError(`账号已被封禁：${activeBan.comment}`, 403);
    }

    return { operator, membership };
  }

  private async clearPrivatePostDraft(draftKey: string) {
    const existing = this.privatePostDrafts.get(draftKey);
    if (!existing) {
      return;
    }
    this.privatePostDrafts.delete(draftKey);
    if (this.config && existing.uploadedKeys.length > 0) {
      await deleteAttachmentObjects(this.config, existing.uploadedKeys).catch((error) => {
        this.logger.warn({ error, draftKey }, "failed to cleanup replaced private post draft attachments");
      });
    }
  }

  private async clearPrivatePostPending(draftKey: string) {
    const existing = this.privatePostPendingModes.get(draftKey);
    if (!existing) {
      return;
    }
    this.privatePostPendingModes.delete(draftKey);
    if (this.config && existing.uploadedKeys.length > 0) {
      await deleteAttachmentObjects(this.config, existing.uploadedKeys).catch((error) => {
        this.logger.warn({ error, draftKey }, "failed to cleanup pending private post attachments");
      });
    }
  }

  private async clearStagedPrivatePostAttachments(uploadedKeys: string[]) {
    if (!this.config || uploadedKeys.length === 0) {
      return;
    }

    await deleteAttachmentObjects(this.config, uploadedKeys).catch((error) => {
      this.logger.warn({ error }, "failed to cleanup staged private post attachments");
    });
  }

  private async stagePrivatePostAttachments(
    bot: { qqUin: bigint; tenantId: string },
    event: OneBotMessageEvent,
  ): Promise<{ attachments: PostAttachment[]; uploadedKeys: string[] }> {
    const imageSegments = extractOneBotImageSegments(event.message);
    if (imageSegments.length === 0) {
      return { attachments: [], uploadedKeys: [] };
    }
    if (imageSegments.length > 9) {
      throw new BotWorkflowError("最多 9 张图片", 400);
    }
    if (!this.config) {
      throw new BotWorkflowError("当前环境未配置附件存储，无法通过图片投稿", 503);
    }

    const compression = await readTenantImageCompression(prisma, bot.tenantId);
    const attachments: PostAttachment[] = [];
    const uploadedKeys: string[] = [];

    try {
      for (const segment of imageSegments) {
        const source = await this.resolvePrivatePostImageSource(bot.qqUin.toString(), segment);
        if (source.bytes.length > 10 * 1024 * 1024) {
          throw new BotWorkflowError("图片最大 10MB，请重新发送更小的图片", 400);
        }
        const fileName = source.fileName || normalizeImageFileName(source.url) || "attachment.jpg";
        const compressed = await compressImageBuffer(source.bytes, source.contentType, compression);
        const attachment = await uploadAttachmentBytes({
          config: this.config,
          tenantId: bot.tenantId,
          kind: "image",
          contentType: source.contentType,
          fileName,
          body: compressed,
        });
        attachments.push(attachment);
        uploadedKeys.push(attachment.key);
      }
      return { attachments, uploadedKeys };
    } catch (error) {
      if (this.config && uploadedKeys.length > 0) {
        await deleteAttachmentObjects(this.config, uploadedKeys).catch((cleanupError) => {
          this.logger.warn({ error: cleanupError }, "failed to cleanup private post attachment upload");
        });
      }
      throw error;
    }
  }

  private async resolvePrivatePostImageSource(botQqUin: string, segment: { data?: Record<string, unknown> }) {
    const data = segment.data ?? {};
    const fileName = normalizeImageFileName(data.file_name ?? data.filename ?? data.name ?? data.file ?? data.url);
    const directSource = typeof (data.url ?? data.file) === "string" ? String(data.url ?? data.file).trim() : null;
    if (directSource?.startsWith("base64://")) {
      return await fetchPrivatePostImage(directSource, fileName);
    }

    const directUrl = readImageUrlCandidate(data.url ?? data.file);
    if (directUrl) {
      return await fetchPrivatePostImage(directUrl, fileName);
    }

    const fileToken = readImageTokenCandidate(data.file);
    if (fileToken) {
      try {
        const response = await this.callAction(botQqUin, "get_image", { file: fileToken });
        const resolvedUrl = extractImageUrlFromOneBotResponse(response);
        if (resolvedUrl) {
          return await fetchPrivatePostImage(resolvedUrl, fileName);
        }
      } catch (error) {
        this.logger.debug({ error, botQqUin }, "onebot get_image fallback failed");
      }
    }

    throw new BotWorkflowError("无法读取图片附件，请重新发送图片", 400);
  }

  private formatPrivatePostDraftSummary(text: string, attachmentCount: number, anonymous: boolean) {
    const parts = [
      `我先帮你记下啦：正文 ${text.length} 字${attachmentCount > 0 ? `，图片 ${attachmentCount} 张` : ""}，${anonymous ? "匿名投稿" : "实名投稿"}。`,
      "如果都准备好了，就发 #结束投稿 提交稿件。",
    ];
    return parts.join("\n");
  }

  private formatPrivatePostPendingSummary(text: string, attachmentCount: number) {
    const parts = [
      `我先帮你记下啦：正文 ${text.length} 字${attachmentCount > 0 ? `，图片 ${attachmentCount} 张` : ""}。`,
      "现在回复 #匿名 或 #实名 选择投稿方式。",
      "如果不想继续，可以发 #取消投稿。",
    ];
    return parts.join("\n");
  }

  private async selectPrivatePostMode({
    bot,
    botQqUin,
    userQqUin,
    anonymous,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
    anonymous: boolean;
  }) {
    await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);

    const draftKey = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    const pending = this.privatePostPendingModes.get(draftKey);
    if (!pending) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "还没有需要选择模式的投稿，先发 #投稿 正文 吧。");
      return;
    }

    this.privatePostPendingModes.delete(draftKey);
    this.privatePostDrafts.set(draftKey, {
      tenantId: pending.tenantId,
      text: pending.text,
      anonymous,
      attachments: pending.attachments,
      uploadedKeys: pending.uploadedKeys,
      updatedAt: Date.now(),
      awaitingImageDecision: true,
    });

    const have = pending.attachments.length > 0 ? `，已有 ${pending.attachments.length} 张图片` : "";
    await this.sendPrivateMessage(
      botQqUin,
      userQqUin,
      `我已记录正文（${pending.text.length} 字${have}）。\n现在回复 #添加图片 / #是 或 #不添加图片 / #否 选择是否添加图片；不想继续可以发 #取消投稿。`,
    );
  }

  private async createPostFromPrivateDraft(
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null },
    userQqUin: string,
    draft: PrivatePostDraft,
  ) {
    const access = await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);
    const text = draft.text.trim();

    if (!text) {
      throw new BotWorkflowError("正文还是空的，先发 #投稿 正文，再发 #结束投稿 吧。", 400);
    }
    if (text.length > 1_000) {
      throw new BotWorkflowError("正文有点长了，先精简到 1000 字以内，再发 #结束投稿 吧。", 400);
    }

    let post: Awaited<ReturnType<typeof prisma.post.create>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        post = await prisma.$transaction(
          async (tx) => {
            const pendingPostLimit = await readTenantPendingPostLimit(tx, bot.tenantId);
            if (pendingPostLimit > 0) {
              const pendingCount = await tx.post.count({
                where: {
                  tenantId: bot.tenantId,
                  authorId: access.operator.id,
                  status: "pending_approval",
                },
              });
              if (pendingCount >= pendingPostLimit) {
                throw new BotWorkflowError(
                  `你还有 ${pendingCount} 条稿件待审核，当前校园墙最多同时保留 ${pendingPostLimit} 条待审核稿件。`,
                  409,
                );
              }
            }

            const tenant = await tx.tenant.update({
              where: {
                id: bot.tenantId,
              },
              data: {
                nextPostDisplayId: {
                  increment: 1,
                },
              },
              select: {
                nextPostDisplayId: true,
              },
            });
            const displayId = tenant.nextPostDisplayId - 1;

            return tx.post.create({
              data: {
                tenantId: bot.tenantId,
                authorId: access.operator.id,
                displayId,
                text,
                anonymous: draft.anonymous,
                attachments: draft.attachments,
                status: "pending_approval",
                logs: {
                  create: {
                    tenantId: bot.tenantId,
                    actorId: access.operator.id,
                    newStatus: "pending_approval",
                    comment: "QQ 私聊投稿创建",
                  },
                },
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error) {
        if (error instanceof BotWorkflowError) {
          throw error;
        }
        if (isTransactionSerializationFailure(error) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    if (!post) {
      throw new BotWorkflowError("投稿人数较多，请稍后再试", 503);
    }

    await writeAuditLog({
      tenantId: bot.tenantId,
      actorId: access.operator.id,
      action: "bot.post.create",
      targetType: "post",
      targetId: post.id,
      detail: {
        botQqUin: bot.qqUin.toString(),
        userQqUin,
        attachmentCount: draft.attachments.length,
      },
    });

    return post;
  }

  private async handleGroupMessage(event: OneBotMessageEvent) {
    const botQqUin = normalizeId(event.self_id);
    const groupId = normalizeId(event.group_id);
    const operatorQqUin = normalizeId(event.user_id);
    if (!botQqUin || !groupId || !operatorQqUin || botQqUin === operatorQqUin) {
      return;
    }

    const bot = await findEnabledBot(botQqUin).catch(() => null);
    if (!bot || normalizeId(bot.reviewGroupId ?? undefined) !== groupId) {
      return;
    }

    const command = parseCommand(extractPlainText(event));
    if (!command) {
      await this.replyToReviewGroupMention(event, botQqUin, groupId);
      return;
    }

    try {
      if (command.name === "通过") {
        const displayId = parseDisplayId(command.args);
        if (!displayId) {
          await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
          return;
        }
        const result = await reviewPostViaBot({
          queue: this.queue,
          botQqUin,
          groupId,
          operatorQqUin,
          displayId,
          action: "approve",
        });
        await this.sendGroupMessage(botQqUin, groupId, `已通过 #${displayId}`);
        await this.notifyReviewResult(result.post.id, "approved").catch(() => undefined);
        return;
      }

      if (command.name === "拒绝") {
        const parsed = parseRejectArgs(command.args);
        if (!parsed) {
          await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
          return;
        }
        const result = await reviewPostViaBot({
          queue: this.queue,
          botQqUin,
          groupId,
          operatorQqUin,
          displayId: parsed.displayId,
          action: "reject",
          comment: parsed.comment,
        });
        await this.sendGroupMessage(botQqUin, groupId, `已拒绝 #${parsed.displayId}，原因：${parsed.comment}`);
        await this.notifyReviewResult(result.post.id, "rejected", parsed.comment).catch(() => undefined);
        return;
      }

      if (["登录", "刷新", "刷新qzone", "刷新QZone", "刷新cookies", "刷新Cookies", "刷新qzonecookies"].includes(command.name)) {
        const rawCookies = await this.getQZoneCookiesFromProtocol(botQqUin);
        const result = await refreshQZoneCookiesViaBot({
          botQqUin,
          groupId,
          operatorQqUin,
          rawCookies,
        });
        const checked = await checkAndUpdateQZoneSession(result.session.id);
        if (checked?.healthStatus === "available") {
          await this.resumeWaitingPublishAttemptsForBot(result.bot.id);
        }
        await this.sendGroupMessage(botQqUin, groupId, `QZone cookies 已刷新（${result.cookieNames.length} 项）。`);
        return;
      }

      if (["扫码登录", "二维码登录", "qzone扫码登录"].includes(command.name)) {
        await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");
        const task = await startQZoneQrLogin({
          botAccountId: bot.id,
          tenantId: bot.tenantId,
        });
        await this.sendGroupMessage(botQqUin, groupId, [
          {
            type: "text",
            data: {
              text: "请使用本号 QQ 手机端扫描以下二维码登录 QZone：",
            },
          },
          {
            type: "image",
            data: {
              file: task.qrImage,
            },
          },
        ]);
        for (let index = 0; index < 60; index += 1) {
          await Bun.sleep(2_000);
          const result = await pollQZoneQrLogin(task.id);
          if (result.status === "succeeded") {
            const session = await prisma.botSession.findFirst({
              where: {
                botAccountId: bot.id,
                type: "qzone",
                domain: qzoneCookieDomain,
              },
              orderBy: {
                refreshedAt: "desc",
              },
            });
            const checked = session ? await checkAndUpdateQZoneSession(session.id) : null;
            if (checked?.healthStatus === "available") {
              await this.resumeWaitingPublishAttemptsForBot(bot.id);
            }
            await this.sendGroupMessage(botQqUin, groupId, `扫码登录完成，QZone cookies 已刷新（${result.cookieNames.length} 项）。`);
            return;
          }
          if (result.status === "expired" || result.status === "failed") {
            await this.sendGroupMessage(botQqUin, groupId, result.message ?? "扫码登录失败");
            return;
          }
        }
        await this.sendGroupMessage(botQqUin, groupId, "扫码登录超时，请重新发送 #扫码登录。");
        return;
      }

      if (command.name === "重发") {
        const displayId = parseDisplayId(command.args);
        if (!displayId) {
          await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
          return;
        }
        await enqueuePublishFanoutByDisplayId(this.queue, bot.tenantId, displayId, operatorQqUin);
        await this.sendGroupMessage(botQqUin, groupId, `已重新加入发布队列：#${displayId}`);
        return;
      }

      await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
    } catch (error) {
      await this.sendGroupMessage(botQqUin, groupId, toErrorMessage(error)).catch(() => undefined);
    }
  }

  private async replyToReviewGroupMention(event: OneBotMessageEvent, botQqUin: string, groupId: string) {
    if (!isMentioningBot(event, botQqUin)) {
      return;
    }
    const bot = await findEnabledBot(botQqUin).catch(() => null);
    if (!bot?.reviewGroupId || bot.reviewGroupId !== groupId) {
      return;
    }
    await this.sendGroupMessage(botQqUin, groupId, bot.reviewGroupMessageReply || reviewHelp).catch((error) => {
      this.logger.warn({ error, botQqUin, groupId }, "failed to send review group auto reply");
    });
  }

  private shouldSendPrivateAutoReply(botAccountId: string, userQqUin: string, cooldownSeconds: number) {
    if (cooldownSeconds <= 0) {
      return true;
    }

    const key = `${botAccountId}:${userQqUin}`;
    const now = Date.now();
    const lastAt = this.privateAutoReplyAt.get(key) ?? 0;
    if (now - lastAt < cooldownSeconds * 1000) {
      return false;
    }

    this.privateAutoReplyAt.set(key, now);
    return true;
  }

  private async getQZoneCookiesFromProtocol(botQqUin: string) {
    try {
      const data = await this.callAction(botQqUin, "get_cookies", {
        domain: qzoneCookieDomain,
      });
      return extractCookiesFromActionData(data);
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw error;
      }

      this.logger.warn({ error, botQqUin }, "onebot get_cookies failed; using development mock cookies");
      return `uin=o${botQqUin}; skey=matcha-dev-skey; p_skey=matcha-dev-pskey; pt4_token=matcha-dev-token`;
    }
  }

  private resolvePendingAction(response: OneBotActionResponse) {
    const pending = response.echo ? this.pendingActions.get(response.echo) : null;
    if (!pending || !response.echo) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingActions.delete(response.echo);
    pending.resolve(response);
  }

  private findConnection(botQqUin: string) {
    for (const connection of this.connections) {
      if (connection.selfId === botQqUin && connection.socket.readyState === 1) {
        return connection;
      }
    }
    return null;
  }

  private async authenticateConnection(request: { headers: Record<string, string | string[] | undefined>; url?: string }) {
    const url = request.url ? new URL(request.url, "http://localhost") : null;
    const botId = getHeaderValue(request.headers["x-bot-id"]) ?? url?.searchParams.get("bot_id") ?? null;
    const token = getHeaderValue(request.headers["x-onebot-token"]) ?? url?.searchParams.get("token") ?? url?.searchParams.get("access_token") ?? null;
    if (!botId || !token) {
      return null;
    }

    const bot = await prisma.botAccount.findFirst({
      where: {
        id: botId,
        connectionToken: token,
        enabled: true,
      },
      select: {
        id: true,
        tenantId: true,
        qqUin: true,
      },
    });
    if (!bot) {
      return null;
    }
    return bot;
  }

  private async markBotSeen(connection: OneBotConnection) {
    await prisma.botAccount.update({
      where: {
        id: connection.botAccountId,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  private async loadPostAttachmentSegments(attachments: unknown) {
    if (!this.config || !Array.isArray(attachments)) {
      return [];
    }
    const s3 = createS3Client(this.config);
    const segments = [];
    for (const attachment of attachments) {
      const candidate = attachment as any;
      if (!candidate.key) {
        continue;
      }
      try {
        const object = await s3.send(
          new GetObjectCommand({
            Bucket: this.config.s3.bucket,
            Key: candidate.key,
          }),
        );
        const body = object.Body;
        if (!body || !("transformToByteArray" in body) || typeof body.transformToByteArray !== "function") {
          continue;
        }
        const bytes = await body.transformToByteArray();
        const contentType = object.ContentType ?? inferImageContentType(candidate.fileName ?? candidate.key);
        segments.push({
          type: "image",
          data: {
            file: `base64://${Buffer.from(bytes).toString("base64")}`,
            type: contentType,
          },
        });
      } catch (error) {
        this.logger.warn({ error, attachmentKey: candidate.key }, "failed to load post attachment for onebot notification");
      }
    }
    return segments;
  }
}

async function enqueuePublishFanoutByDisplayId(queue: RuntimeQueue, tenantId: string, displayId: number, operatorQqUin: string) {
  const { enqueuePublishFanout } = await import("./publishing");
  const { operator } = await requireBotTenantRole(tenantId, operatorQqUin, "reviewer");
  const post = await prisma.post.findFirst({
    where: {
      tenantId,
      displayId,
    },
  });
  if (!post) {
    throw new BotWorkflowError(`稿件 #${displayId} 不存在`, 404);
  }
  await enqueuePublishFanout(queue, tenantId, post.id, operator.id);
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function inferImageContentType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  return "image/jpeg";
}

function getHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function extractPlainText(event: OneBotMessageEvent) {
  if (Array.isArray(event.message)) {
    return event.message
      .map((segment) => {
        const item = segment as { type?: string; data?: { text?: string } };
        return item.type === "text" ? (item.data?.text ?? "") : "";
      })
      .join("");
  }
  if (typeof event.message === "string") {
    return event.message;
  }
  if (typeof event.raw_message === "string") {
    return event.raw_message;
  }
  return "";
}

function isMentioningBot(event: OneBotMessageEvent, botQqUin: string) {
  if (typeof event.raw_message === "string" && new RegExp(`\\[CQ:at,qq=${escapeRegex(botQqUin)}\\]`).test(event.raw_message)) {
    return true;
  }
  if (!Array.isArray(event.message)) {
    return false;
  }
  return event.message.some((segment) => {
    const item = segment as { type?: string; data?: { qq?: string | number } };
    return item.type === "at" && normalizeId(item.data?.qq) === botQqUin;
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCommand(input: string) {
  const normalized = input.replace(/\[CQ:at,qq=\d+\]/g, "").trim();
  const commandStart = normalized.search(/[#/]/);
  if (commandStart < 0) {
    return null;
  }
  const prefix = normalized.slice(0, commandStart).trim();
  if (prefix && !prefix.startsWith("@")) {
    return null;
  }
  const commandText = normalized.slice(commandStart);
  const match = commandText.match(/^[#/]\s*([^\s]+)\s*(.*)$/);
  const name = match?.[1];
  if (!match || !name) {
    return null;
  }
  return {
    name,
    args: match[2]?.trim() ?? "",
  };
}

function parsePrivateCommand(input: string) {
  const command = parseCommand(input);
  if (command) {
    return command;
  }

  const normalized = input.trim();
  const match = normalized.match(/^(注册账号|重置密码)(?:\s+(.*))?$/);
  if (!match?.[1]) {
    return null;
  }
  return {
    name: match[1],
    args: match[2]?.trim() ?? "",
  };
}

function parseDisplayId(args: string) {
  const id = Number(args.trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseRejectArgs(args: string) {
  const match = args.trim().match(/^(.*\S)\s+(\d+)$/);
  if (!match) {
    return null;
  }
  const comment = match[1];
  const id = match[2];
  if (!comment || !id) {
    return null;
  }
  const displayId = Number(id);
  if (!Number.isInteger(displayId) || displayId <= 0) {
    return null;
  }
  return {
    comment: comment.trim(),
    displayId,
  };
}

function normalizeId(value: string | number | undefined) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

function extractCookiesFromActionData(data: unknown) {
  if (typeof data === "string") {
    return data;
  }
  if (data && typeof data === "object" && "cookies" in data) {
    const cookies = (data as { cookies?: unknown }).cookies;
    if (typeof cookies === "string") {
      return cookies;
    }
    if (cookies && typeof cookies === "object") {
      return Object.entries(cookies as Record<string, unknown>)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join("; ");
    }
  }
  throw new BotWorkflowError("协议端没有返回 cookies 数据", 502);
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Bot 命令处理失败";
}

function formatQZoneAutoRefreshReason(reason: string) {
  if (reason === "publish_login_required") {
    return "发布时检测到登录态失效";
  }
  if (reason === "publish_preflight_invalid") {
    return "发布前发现登录态不可用";
  }
  return "定时检测发现登录态失效";
}

function isTransactionSerializationFailure(value: unknown) {
  return value instanceof Prisma.PrismaClientKnownRequestError && value.code === "P2034";
}

function normalizeImageFileName(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("base64://")) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    const lastPathPart = url.pathname.split("/").filter(Boolean).pop();
    return lastPathPart || undefined;
  } catch {
    const withoutQuery = trimmed.split("?")[0];
    const lastPathPart = withoutQuery.split("/").filter(Boolean).pop();
    return lastPathPart || undefined;
  }
}

function readImageUrlCandidate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function readImageTokenCandidate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("base64://") || /^https?:\/\//i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function extractImageUrlFromOneBotResponse(data: unknown) {
  if (typeof data === "string" && /^https?:\/\//i.test(data)) {
    return data;
  }
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as { url?: unknown; file?: unknown; data?: { url?: unknown; file?: unknown } };
  const direct = typeof candidate.url === "string" ? candidate.url : typeof candidate.file === "string" ? candidate.file : null;
  if (typeof direct === "string" && /^https?:\/\//i.test(direct)) {
    return direct;
  }

  const nested = candidate.data;
  if (nested) {
    const nestedUrl = typeof nested.url === "string" ? nested.url : typeof nested.file === "string" ? nested.file : null;
    if (typeof nestedUrl === "string" && /^https?:\/\//i.test(nestedUrl)) {
      return nestedUrl;
    }
  }

  return null;
}

async function fetchPrivatePostImage(source: string, fileName?: string) {
  if (source.startsWith("base64://")) {
    const bytes = Buffer.from(source.slice("base64://".length), "base64");
    return {
      bytes,
      contentType: inferImageContentType(fileName || "attachment.jpg"),
      fileName,
      url: source,
    };
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new BotWorkflowError(`图片下载失败：${response.status}`, 502);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const headerContentType = response.headers.get("content-type")?.split(";")[0]?.trim() || null;
  const contentType = headerContentType && headerContentType.startsWith("image/")
    ? headerContentType
    : inferImageContentType(fileName || source);

  return {
    bytes,
    contentType,
    fileName,
    url: source,
  };
}
