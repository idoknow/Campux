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
import { extractOneBotImageSegments, extractOneBotPlainText, isPrivatePostCancelText, isPrivatePostFinishText, isPrivatePostUndoText, parsePrivatePostModeText, parsePrivatePostStartText } from "../lib/private-posting";
import { readTenantImageCompression, readTenantPendingPostLimit, readTenantBotStylishMessagesEnabled, readTenantBotPrivatePostStylishEnabled } from "../lib/tenant-metadata";
import type { RuntimeQueue } from "./queue";
import { checkAndUpdateQZoneSession } from "../lib/qzone-cookies";
import { QZoneProtocolAutoRefreshCooldownError, qzoneProtocolAutoRefreshFailureCooldownMs } from "../lib/qzone-auto-refresh";
import { pollQZoneQrLogin, startQZoneQrLogin } from "../lib/qzone-login";
import { resumePublishAttemptsWaitingForCookies } from "./publishing";
import { selectReviewNotificationBot } from "./notification-routing";
import {
  formatNewPostReviewNotification,
  formatPostCancelled,
  formatRecallRequestNotification,
  formatPostRecalledGroup,
  formatRecallSuccess,
  formatRecallRejectedNotification,
  formatRecallRejected,
  formatRecallFailedNotification,
  formatReviewApproved,
  formatReviewRejected,
  formatPublishSuccess,
  formatPublishSuccessWithTarget,
  formatPublishFailed,
  publishFailedLoginHint,
  formatPublishWaiting,
  publishWaitingResumeHint,
  formatCookiesInvalid,
  formatCookiesAutoRefreshed,
  formatCookiesRefreshed,
  formatSubmissionSuccess,
  formatRegisterSuccess,
  formatRegisterAlready,
  formatRegisterExtended,
  formatResetPassword,
  formatUndoText,
  formatUndoImages,
  formatQrLoginSuccess,
  formatQrLoginTimeout,
  formatReviewApprovedGroup,
  formatReviewRejectedGroup,
  formatRequeue,
  formatPrivatePostModePrompt,
  formatPrivatePostDraftPrompt,
  formatPrivatePostContinuePrompt,
  formatPrivatePostCancelled,
  formatPrivateHelp,
} from "../lib/bot-messages";
import { buildFriendRequestAutoApprovePlan, buildSetFriendAddRequestParams, type OneBotRequestEvent } from "./onebot-friend-requests";

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

type QZoneProtocolAutoRefreshFailure = {
  failedAt: number;
  error: string;
};

type OneBotActionResponse = {
  echo?: string;
  status?: string;
  retcode?: number;
  data?: unknown;
  message?: string;
  wording?: string;
};

type PrivatePostHistoryEntry =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "images";
      attachmentCount: number;
      uploadedKeys: string[];
    };

type PrivatePostDraft = {
  tenantId: string;
  text: string;
  anonymous: boolean;
  attachments: PostAttachment[];
  uploadedKeys: string[];
  updatedAt: number;
  history: PrivatePostHistoryEntry[];
};

type PrivatePostPendingMode = {
  tenantId: string;
  text: string;
  attachments: PostAttachment[];
  uploadedKeys: string[];
  updatedAt: number;
  history: PrivatePostHistoryEntry[];
};

type OneBotMessageEvent = {
  post_type?: string;
  request_type?: string;
  message_type?: "private" | "group";
  self_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  flag?: string;
  comment?: string;
  message?: unknown;
  raw_message?: string;
  sender?: {
    nickname?: string;
    card?: string;
  };
  message_id?: number | string;
  // Some OneBot implementations include reply metadata in the message segments
  // but we treat them as part of `message` / `raw_message` as fallback.
};

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
  private readonly pendingFriendRequestFlags = new Set<string>();
  private readonly qzoneProtocolAutoRefreshFailures = new Map<string, QZoneProtocolAutoRefreshFailure>();
  private readonly qzoneProtocolAutoRefreshInFlight = new Map<string, Promise<{ cookieNames: string[]; session: { id: string } }>>();

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
    const lines = formatNewPostReviewNotification(
      post.tenant.name,
      post.displayId,
      post.author.displayName ?? "未命名",
      post.anonymous,
      post.author.qqUin,
      post.text,
      imageCount,
    );
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    await this.sendTenantReviewNotification(post.tenantId, formatPostCancelled(post.displayId, stylishEnabled));
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    const message = formatRecallRequestNotification(
      post.displayId,
      post.author.displayName ?? "未命名用户",
      post.author.qqUin,
      readRecallReason(post.logs[0]?.comment) ?? "未填写",
      stylishEnabled,
    );
    await this.sendTenantReviewNotification(post.tenantId, message);
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    const groupSuffix = opts?.skipAuthor ? "\n（静默撤回，未通知作者）" : "";
    await this.sendTenantReviewNotification(post.tenantId, formatPostRecalledGroup(post.displayId, targetCount, stylishEnabled) + groupSuffix);

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
      await this.sendPrivateMessage(bot.qqUin.toString(), post.author.qqUin, formatRecallSuccess(post.displayId, stylishEnabled)).catch((error) => {
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    await this.sendTenantReviewNotification(post.tenantId, formatRecallRejectedNotification(post.displayId, reason, stylishEnabled));

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
      await this.sendPrivateMessage(bot.qqUin.toString(), post.author.qqUin, formatRecallRejected(post.displayId, reason, stylishEnabled)).catch((error) => {
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    const message = formatRecallFailedNotification(post.displayId, failed.map((r) => ({
      targetName: r.targetName,
      qzoneTid: r.qzoneTid,
      message: r.message,
    })), stylishEnabled);
    await this.sendTenantReviewNotification(post.tenantId, message);
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    const message = status === "approved"
      ? formatReviewApproved(post.displayId, stylishEnabled)
      : formatReviewRejected(post.displayId, comment?.trim() || "审核拒绝", stylishEnabled);

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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    if (!target) {
      await this.sendTenantReviewNotification(post.tenantId, formatPublishSuccess(post.displayId, externalId, stylishEnabled));
      return;
    }
    await this.sendBotReviewGroupMessage(target.botAccount, formatPublishSuccessWithTarget(post.displayId, target.displayName, externalId, stylishEnabled), "failed to notify publish succeeded");
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    const lines = [
      formatPublishFailed(post.displayId, !!options?.needsLogin, stylishEnabled),
      target ? `目标：${target.displayName}（${target.botAccount.displayName} / QQ ${target.botAccount.qqUin.toString()}）` : null,
      `原因：${message}`,
      options?.needsLogin ? publishFailedLoginHint : null,
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, post.tenantId);
    const lines = [
      formatPublishWaiting(post.displayId, stylishEnabled),
      target ? `目标：${target.displayName}（${target.botAccount.displayName} / QQ ${target.botAccount.qqUin.toString()}）` : null,
      `原因：${message}`,
      publishWaitingResumeHint,
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
    await this.sendGroupMessage(
      bot.qqUin.toString(),
      bot.reviewGroupId,
      [
        formatCookiesInvalid(options?.autoRefreshError, stylishEnabled),
        `墙号：${bot.displayName} / QQ ${bot.qqUin.toString()}`,
        `检测结果：${message}`,
        options?.autoRefreshError ? `自动刷新失败：${options.autoRefreshError}` : null,
      ].filter((line): line is string => Boolean(line)).join("\n"),
    ).catch((error) => {
      this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify qzone cookies invalid");
    });
  }

  async refreshQZoneCookiesByProtocol(botAccountId: string, reason: "heartbeat_invalid" | "publish_login_required" | "publish_preflight_invalid") {
    const cachedFailure = this.qzoneProtocolAutoRefreshFailures.get(botAccountId);
    if (cachedFailure) {
      const remainingMs = qzoneProtocolAutoRefreshFailureCooldownMs - (Date.now() - cachedFailure.failedAt);
      if (remainingMs > 0) {
        throw new QZoneProtocolAutoRefreshCooldownError(remainingMs, cachedFailure.error);
      }
      this.qzoneProtocolAutoRefreshFailures.delete(botAccountId);
    }

    const inFlight = this.qzoneProtocolAutoRefreshInFlight.get(botAccountId);
    if (inFlight) {
      return inFlight;
    }

    const refresh = this.doRefreshQZoneCookiesByProtocol(botAccountId, reason);
    this.qzoneProtocolAutoRefreshInFlight.set(botAccountId, refresh);
    try {
      return await refresh;
    } finally {
      this.qzoneProtocolAutoRefreshInFlight.delete(botAccountId);
    }
  }

  private async doRefreshQZoneCookiesByProtocol(botAccountId: string, reason: "heartbeat_invalid" | "publish_login_required" | "publish_preflight_invalid") {
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
      this.qzoneProtocolAutoRefreshFailures.delete(bot.id);
      await this.notifyQZoneCookiesAutoRefreshed(bot.id, reason, result.cookieNames.length, checked?.healthMessage ?? null);
      await this.resumeWaitingPublishAttemptsForBot(bot.id);
      return result;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.qzoneProtocolAutoRefreshFailures.set(bot.id, {
        failedAt: Date.now(),
        error: errorMessage,
      });
      await writeAuditLog({
        tenantId: bot.tenantId,
        actorId: null,
        action: "bot.qzone.cookies.auto_refresh_failed",
        targetType: "bot_account",
        targetId: bot.id,
        detail: {
          reason,
          source: "protocol",
          error: errorMessage,
          cooldownMs: qzoneProtocolAutoRefreshFailureCooldownMs,
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
    await this.sendGroupMessage(
      bot.qqUin.toString(),
      bot.reviewGroupId,
      [
        formatCookiesAutoRefreshed(stylishEnabled),
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

  /**
   * Sends a private message to a user via the first online, enabled bot of the
   * tenant that succeeds. Returns true if delivered. Used by the followed-post
   * comment digest scheduler so a user with multiple walls/bots only gets one
   * copy of each digest instead of one per bot.
   */
  async sendPrivateMessageViaTenantBots(tenantId: string, userQqUin: string | bigint, message: string): Promise<boolean> {
    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId,
        enabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    for (const bot of bots) {
      const status = this.getBotConnectionStatus(bot.qqUin.toString());
      if (!status.online) {
        continue;
      }
      try {
        await this.sendPrivateMessage(bot.qqUin.toString(), userQqUin, message);
        return true;
      } catch (error) {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), tenantId }, "failed to send private message via tenant bot");
      }
    }
    return false;
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

    if ((event as OneBotMessageEvent).post_type === "request") {
      await this.handleRequestEvent(connection, event as OneBotRequestEvent);
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

  private async handleRequestEvent(connection: OneBotConnection, event: OneBotRequestEvent) {
    if (event.request_type !== "friend") {
      return;
    }

    const bot = await prisma.botAccount.findFirst({
      where: {
        id: connection.botAccountId,
        tenantId: connection.tenantId,
      },
      select: {
        id: true,
        tenantId: true,
        qqUin: true,
        displayName: true,
        enabled: true,
        autoFriendRequestApprovalEnabled: true,
      },
    });
    if (!bot) {
      this.logger.warn({ botAccountId: connection.botAccountId, tenantId: connection.tenantId }, "onebot friend request ignored because bot account no longer exists");
      return;
    }

    const plan = buildFriendRequestAutoApprovePlan(event, bot);
    const userQqUin = normalizeId(event.user_id);
    const flag = typeof event.flag === "string" ? event.flag : null;
    if (!plan) {
      this.logger.info(
        {
          botAccountId: bot.id,
          tenantId: bot.tenantId,
          botQqUin: bot.qqUin.toString(),
          userQqUin,
          autoFriendRequestApprovalEnabled: bot.autoFriendRequestApprovalEnabled,
          botEnabled: bot.enabled,
          hasFlag: Boolean(flag),
        },
        "onebot friend request received but auto approval is not scheduled",
      );
      return;
    }

    if (this.pendingFriendRequestFlags.has(plan.flag)) {
      this.logger.info({ botAccountId: bot.id, botQqUin: bot.qqUin.toString(), userQqUin: plan.userQqUin }, "onebot friend request auto approval already scheduled");
      return;
    }

    this.pendingFriendRequestFlags.add(plan.flag);
    this.logger.info(
      {
        botAccountId: bot.id,
        tenantId: bot.tenantId,
        botQqUin: bot.qqUin.toString(),
        userQqUin: plan.userQqUin,
        delayMs: plan.delayMs,
        comment: plan.comment,
      },
      "onebot friend request auto approval scheduled",
    );

    setTimeout(() => {
      this.executeFriendRequestAutoApproval({
        botAccountId: bot.id,
        tenantId: bot.tenantId,
        botQqUin: bot.qqUin.toString(),
        userQqUin: plan.userQqUin,
        flag: plan.flag,
        delayMs: plan.delayMs,
      }).catch((error) => {
        this.logger.warn({ error, botAccountId: bot.id, botQqUin: bot.qqUin.toString(), userQqUin: plan.userQqUin }, "onebot friend request auto approval failed");
      });
    }, plan.delayMs);
  }

  private async executeFriendRequestAutoApproval(options: { botAccountId: string; tenantId: string; botQqUin: string; userQqUin: string; flag: string; delayMs: number }) {
    try {
      const bot = await prisma.botAccount.findFirst({
        where: {
          id: options.botAccountId,
          tenantId: options.tenantId,
        },
        select: {
          enabled: true,
          autoFriendRequestApprovalEnabled: true,
        },
      });

      if (!bot?.enabled || !bot.autoFriendRequestApprovalEnabled) {
        this.logger.info(
          {
            botAccountId: options.botAccountId,
            tenantId: options.tenantId,
            botQqUin: options.botQqUin,
            userQqUin: options.userQqUin,
            botEnabled: bot?.enabled ?? false,
            autoFriendRequestApprovalEnabled: bot?.autoFriendRequestApprovalEnabled ?? false,
          },
          "onebot friend request auto approval skipped before execution",
        );
        return;
      }

      await this.callAction(options.botQqUin, "set_friend_add_request", buildSetFriendAddRequestParams(options.flag), 12_000);
      this.logger.info(
        {
          botAccountId: options.botAccountId,
          tenantId: options.tenantId,
          botQqUin: options.botQqUin,
          userQqUin: options.userQqUin,
          delayMs: options.delayMs,
        },
        "onebot friend request auto approved",
      );
      await writeAuditLog({
        tenantId: options.tenantId,
        actorId: null,
        action: "bot.friend_request.auto_approve",
        targetType: "bot_account",
        targetId: options.botAccountId,
        detail: {
          botQqUin: options.botQqUin,
          userQqUin: options.userQqUin,
          delayMs: options.delayMs,
        },
      });
    } finally {
      this.pendingFriendRequestFlags.delete(options.flag);
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

      // 读取租户配置的额外投稿触发关键词
      const aiRulesRecord = await prisma.tenantAiSettings.findUnique({
        where: { tenantId: bot.tenantId },
        select: { rules: true },
      });
      const extraKeywords = (aiRulesRecord?.rules as { postTriggerKeywords?: string[] } | null)?.postTriggerKeywords;

      const startBody = parsePrivatePostStartText(plainText, extraKeywords);
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
      if (isPrivatePostUndoText(plainText)) {
        await this.undoPrivatePostDraftEntry({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      const pendingMode = this.privatePostPendingModes.get(draftKey);
      if (pendingMode) {
        const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
        if (isPrivatePostFinishText(plainText)) {
          await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostModePrompt(privateStylishEnabled));
          return;
        }

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

        await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostModePrompt(privateStylishEnabled));
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
          const appended = await this.appendPrivatePostContent({ bot, botQqUin, userQqUin, event, target: draft });
          if (appended) {
            const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
            await this.sendPrivateMessage(botQqUin, userQqUin, this.formatPrivatePostDraftSummary(draft.text, draft.attachments.length, draft.anonymous, privateStylishEnabled));
            return;
          }

          return;
      }

      const command = parsePrivateCommand(plainText);
      if (!command) {
        if (this.shouldSendPrivateAutoReply(bot.id, userQqUin, bot.userMessageReplyCooldownSeconds)) {
          const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
          await this.sendPrivateMessage(botQqUin, userQqUin, bot.userMessageReply || formatPrivateHelp(stylishEnabled)).catch(() => undefined);
        }
        return;
      }

      if (command.name === "注册账号") {
        const result = await registerUserViaBot({
          botQqUin,
          userQqUin,
          displayName: event.sender?.card || event.sender?.nickname || null,
        });
        const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
        const message = result.password
          ? formatRegisterSuccess(result.password, stylishEnabled)
          : result.alreadyHadTenantAccess
            ? formatRegisterAlready(stylishEnabled)
            : formatRegisterExtended(stylishEnabled);
        await this.sendPrivateMessage(botQqUin, userQqUin, message);
        return;
      }
      if (command.name === "重置密码") {
        const result = await resetPasswordViaBot({
          botQqUin,
          userQqUin,
        });
        const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
        await this.sendPrivateMessage(botQqUin, userQqUin, formatResetPassword(result.password, stylishEnabled));
        return;
      }

      const generalStylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
      await this.sendPrivateMessage(botQqUin, userQqUin, bot.userMessageReply || formatPrivateHelp(generalStylishEnabled));
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
    const history: PrivatePostHistoryEntry[] = [];
    if (text) {
      history.push({ type: "text", text });
    }
    if (attachments.length > 0) {
      history.push({ type: "images", attachmentCount: attachments.length, uploadedKeys: staged.uploadedKeys });
    }
    this.privatePostPendingModes.set(draftKey, {
      tenantId: bot.tenantId,
      text,
      attachments,
      uploadedKeys: staged.uploadedKeys,
      updatedAt: Date.now(),
      history,
    });

    const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
    const summary = this.formatPrivatePostPendingSummary(text, attachments.length, privateStylishEnabled);
    await this.sendPrivateMessage(botQqUin, userQqUin, summary);
  }

  private async appendPrivatePostContent({
    bot,
    botQqUin,
    userQqUin,
    event,
    target,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
    event: OneBotMessageEvent;
    target: PrivatePostDraft | PrivatePostPendingMode;
  }) {
    await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);

    const draftText = extractOneBotPlainText(event.message, event.raw_message).trim();
    const imageSegments = extractOneBotImageSegments(event.message);

    if (draftText.length > 0) {
      const combined = (target.text ? `${target.text}\n${draftText}` : draftText).trim();
      if (combined.length > 1_000) {
        await this.sendPrivateMessage(botQqUin, userQqUin, "正文太长了，合并后请控制在 1000 字以内。");
        return false;
      }
    }

    let staged: { attachments: PostAttachment[]; uploadedKeys: string[] } | null = null;

    if (imageSegments.length > 0) {
      try {
        staged = await this.stagePrivatePostAttachments(bot, event);
      } catch (error) {
        await this.sendPrivateMessage(botQqUin, userQqUin, toErrorMessage(error)).catch(() => undefined);
        return false;
      }
      if (staged.attachments.length === 0) {
        staged = null;
      }
    }

    if (staged) {
      if (target.attachments.length + staged.attachments.length > 9) {
        await this.clearStagedPrivatePostAttachments(staged.uploadedKeys);
        await this.sendPrivateMessage(botQqUin, userQqUin, "图片最多 9 张，请删减后再继续发送。");
        return false;
      }
    }

    if (draftText.length > 0) {
      target.text = (target.text ? `${target.text}\n${draftText}` : draftText).trim();
      target.history.push({ type: "text", text: draftText });
    }

    if (staged) {
      target.attachments.push(...staged.attachments);
      target.uploadedKeys.push(...staged.uploadedKeys);
      target.history.push({ type: "images", attachmentCount: staged.attachments.length, uploadedKeys: staged.uploadedKeys });
    }

    const didAppend = draftText.length > 0 || staged !== null;
    if (didAppend) {
      target.updatedAt = Date.now();
    }
    return didAppend;
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
      const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
      await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostCancelled(privateStylishEnabled));
      return;
    }

    const draft = this.privatePostDrafts.get(draftKey);
    if (!draft) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "还没有进行中的投稿。");
      return;
    }

    await this.clearPrivatePostDraft(draftKey);
    const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
    await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostCancelled(privateStylishEnabled));
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
      await this.sendPrivateMessage(botQqUin, userQqUin, "请先发送稿件正文或图片，再发送 #结束。");
      return;
    }
    if (text.length > 1_000) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "正文太长了，请控制在 1000 字以内，再发送 #结束。");
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
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
    await this.sendPrivateMessage(botQqUin, userQqUin, formatSubmissionSuccess(post.displayId, stylishEnabled));
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

  private formatPrivatePostDraftSummary(text: string, attachmentCount: number, anonymous: boolean, stylishEnabled = false) {
    void text;
    void attachmentCount;
    void anonymous;
    return formatPrivatePostDraftPrompt(stylishEnabled);
  }

  private formatPrivatePostPendingSummary(text: string, attachmentCount: number, stylishEnabled = false) {
    void text;
    void attachmentCount;
    return formatPrivatePostModePrompt(stylishEnabled);
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
      await this.sendPrivateMessage(botQqUin, userQqUin, "请先发送 #投稿 开始对话框投稿。");
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
      history: pending.history,
    });

    const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
    await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostContinuePrompt(privateStylishEnabled));
  }

  private async undoPrivatePostDraftEntry({
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
      const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
      const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
      const undone = await this.popPrivatePostHistoryEntry(draftKey, pending, stylishEnabled);
      if (!undone) {
        await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostModePrompt(privateStylishEnabled));
        return;
      }
      await this.sendPrivateMessage(botQqUin, userQqUin, this.formatPrivatePostPendingSummary(pending.text, pending.attachments.length, privateStylishEnabled));
      return;
    }

    const draft = this.privatePostDrafts.get(draftKey);
    if (!draft) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "请先发送 #投稿 开始对话框投稿。");
      return;
    }

    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
    const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
    const undone = await this.popPrivatePostHistoryEntry(draftKey, draft, stylishEnabled);
    if (!undone) {
      await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostDraftPrompt(privateStylishEnabled));
      return;
    }
    await this.sendPrivateMessage(botQqUin, userQqUin, this.formatPrivatePostDraftSummary(draft.text, draft.attachments.length, draft.anonymous, privateStylishEnabled));
  }

  private async popPrivatePostHistoryEntry(draftKey: string, target: PrivatePostDraft | PrivatePostPendingMode, stylishEnabled = false) {
    const entry = target.history.pop();
    if (!entry) {
      return null;
    }

    if (entry.type === "text") {
      target.text = this.rebuildPrivatePostText(target.history);
      target.updatedAt = Date.now();
      return formatUndoText(stylishEnabled);
    }

    target.attachments.splice(-entry.attachmentCount, entry.attachmentCount);
    target.uploadedKeys = target.uploadedKeys.filter((key) => !entry.uploadedKeys.includes(key));
    target.updatedAt = Date.now();
    await this.clearStagedPrivatePostAttachments(entry.uploadedKeys).catch((error) => {
      this.logger.warn({ error, draftKey }, "failed to cleanup undone private post attachments");
    });
    return formatUndoImages(entry.attachmentCount, stylishEnabled);
  }

  private rebuildPrivatePostText(history: PrivatePostHistoryEntry[]) {
    return history
      .filter((entry): entry is Extract<PrivatePostHistoryEntry, { type: "text" }> => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n")
      .trim();
  }

  private async createPostFromPrivateDraft(
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null },
    userQqUin: string,
    draft: PrivatePostDraft,
  ) {
    const access = await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);
    const text = draft.text.trim();

    if (!text) {
      throw new BotWorkflowError("请先发送稿件正文或图片，再发送 #结束。", 400);
    }
    if (text.length > 1_000) {
      throw new BotWorkflowError("正文太长了，请控制在 1000 字以内，再发送 #结束。", 400);
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

    let command = parseCommand(extractPlainText(event));

    // 如果没有以 # 或 / 明确给出命令，但消息是 @ 机器人的短命令（比如 过/拒），支持基于 mention 的快捷命令。
    if (!command && isMentioningBot(event, botQqUin)) {
      const normalized = extractPlainText(event).replace(/\[CQ:at,qq=\d+\]/g, "").trim();
      const shortMatch = normalized.match(/^(过|通过)(?:\s*(.*))?$/);
      if (shortMatch) {
        command = { name: "通过", args: (shortMatch[2] ?? "").trim() };
      } else {
        const rejectMatch = normalized.match(/^(拒|拒绝)(?:\s*(.*))?$/);
        if (rejectMatch) {
          command = { name: "拒绝", args: (rejectMatch[2] ?? "").trim() };
        }
      }
    }

    if (!command) {
      await this.replyToReviewGroupMention(event, botQqUin, groupId);
      return;
    }

    try {
      const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);

      if (command.name === "通过") {
        let displayId = parseDisplayId(command.args);
        // 尝试从引用消息解析稿件编号：仅在操作员 mention 机器人且存在引用时才解析
        if (!displayId && isMentioningBot(event, botQqUin)) {
          displayId = await this.tryResolveDisplayIdFromReply(event, botQqUin);
        }
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
        await this.sendGroupMessage(botQqUin, groupId, formatReviewApprovedGroup(displayId, stylishEnabled));
        await this.notifyReviewResult(result.post.id, "approved").catch(() => undefined);
        return;
      }

      if (command.name === "拒绝") {
        // 拒绝可以是：#拒绝 <理由> <稿件id>
        // 也可以是：@bot 引用机器人通知消息之后发送 "拒 <理由>"
        let parsed = parseRejectArgs(command.args);
        if (!parsed) {
          // 如果没有在 args 里解析到 displayId，尝试从引用消息里解析
          const commentOnly = command.args.trim();
          if (!commentOnly) {
            await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
            return;
          }
          const displayIdFromReply = isMentioningBot(event, botQqUin)
            ? await this.tryResolveDisplayIdFromReply(event, botQqUin)
            : null;
          if (!displayIdFromReply) {
            await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
            return;
          }
          parsed = { displayId: displayIdFromReply, comment: commentOnly };
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
        await this.sendGroupMessage(botQqUin, groupId, formatReviewRejectedGroup(parsed.displayId, parsed.comment, stylishEnabled));
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
        await this.sendGroupMessage(botQqUin, groupId, formatCookiesRefreshed(result.cookieNames.length, stylishEnabled));
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
          await sleep(2_000);
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
            await this.sendGroupMessage(botQqUin, groupId, formatQrLoginSuccess(result.cookieNames.length, stylishEnabled));
            return;
          }
          if (result.status === "expired" || result.status === "failed") {
            await this.sendGroupMessage(botQqUin, groupId, result.message ?? "扫码登录失败");
            return;
          }
        }
        await this.sendGroupMessage(botQqUin, groupId, formatQrLoginTimeout(stylishEnabled));
        return;
      }

      if (command.name === "重发") {
        const displayId = parseDisplayId(command.args);
        if (!displayId) {
          await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
          return;
        }
        await enqueuePublishFanoutByDisplayId(this.queue, bot.tenantId, displayId, operatorQqUin);
        await this.sendGroupMessage(botQqUin, groupId, formatRequeue(displayId, stylishEnabled));
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

  private async tryResolveDisplayIdFromReply(event: OneBotMessageEvent, botQqUin: string): Promise<number | null> {
    try {
      const replyId = (() => {
        if (typeof event.raw_message === "string") {
          const m = event.raw_message.match(/\[CQ:reply,id=(\d+)(?:,.*)?\]/);
          if (m) return m[1];
        }
        if (Array.isArray(event.message)) {
          for (const seg of event.message as any[]) {
            if (!seg || typeof seg !== "object") continue;
            if (seg.type === "reply") {
              const id = seg.data?.id ?? seg.data?.msg_id ?? seg.data?.message_id;
              if (id) return String(id);
            }
          }
        }
        if (event.message_id) {
          return String(event.message_id);
        }
        return null;
      })();

      if (!replyId) {
        return null;
      }

      const data = await this.callAction(botQqUin, "get_msg", { message_id: replyId }).catch(() => null);
      if (!data) return null;

      // Verify the replied message was sent by the bot itself
      const sender = (data as any).sender ?? (data as any).user ?? null;
      const senderId = sender
        ? normalizeId(sender.user_id ?? sender.userId ?? sender.uin ?? sender.qq ?? sender.id)
        : null;
      if (!senderId || senderId !== botQqUin) {
        return null;
      }

      // data may contain `message` (array) or `raw_message` or `message` string
      let text = "";
      if (Array.isArray((data as any).message)) {
        text = (data as any).message
          .map((seg: any) => (seg?.type === "text" ? seg?.data?.text ?? "" : ""))
          .join("");
      } else if (typeof (data as any).message === "string") {
        text = (data as any).message;
      } else if (typeof (data as any).raw_message === "string") {
        text = (data as any).raw_message;
      }

      if (!text) return null;

      // Try to extract displayId from notification text: prefer `编号：#123` then `#123`
      const m = text.match(/(?:编号：#|#)(\d+)\b/);
      if (!m) return null;
      const id = Number(m[1]);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch (error) {
      return null;
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
    const now = new Date();
    await prisma.botAccount.update({
      where: {
        id: connection.botAccountId,
      },
      data: {
        lastSeenAt: now,
      },
    });
    // First successful bot connection marks the wall as ready: the operator has
    // proven control of the wall QQ via NapCat, so the workspace can unlock.
    // readyAt is set once and never cleared, so a temporary disconnect later
    // does not lock the operator back out.
    const tenant = await prisma.tenant.findUnique({
      where: { id: connection.tenantId },
      select: { readyAt: true, archiveWarningAt: true },
    });
    if (tenant && tenant.readyAt === null) {
      await prisma.tenant.update({
        where: { id: connection.tenantId },
        data: { readyAt: now, archiveWarningAt: null },
      });
      await writeAuditLog({
        tenantId: connection.tenantId,
        actorId: null,
        action: "tenant.ready",
        targetType: "tenant",
        targetId: connection.tenantId,
        detail: { botAccountId: connection.botAccountId, selfId: connection.selfId },
      }).catch((error) => this.logger.warn({ error, tenantId: connection.tenantId }, "failed to write tenant.ready audit log"));
      this.logger.info({ tenantId: connection.tenantId, botAccountId: connection.botAccountId }, "tenant marked ready after first bot connection");
    } else if (tenant && tenant.archiveWarningAt !== null) {
      // A previously ready tenant reconnecting clears any pending archive warning.
      await prisma.tenant.update({
        where: { id: connection.tenantId },
        data: { archiveWarningAt: null },
      });
    }
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const withoutQuery = (trimmed.split("?")[0] ?? "").toString();
    const lastPathPart = withoutQuery.split("/").filter(Boolean).pop();
    return lastPathPart ?? undefined;
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
