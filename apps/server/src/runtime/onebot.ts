import { Buffer } from "node:buffer";
import type { FastifyBaseLogger } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { getStorageDriver, setQZoneEmotionPrivate } from "@campux/integrations";
import { Prisma, TransactionIsolationLevel, isPrismaKnownRequestError } from "@campux/db";
import {
  BotWorkflowError,
  approveAllPendingPostsViaBot,
  findEnabledBot,
  qzoneCookieDomain,
  publishTextDirectViaBot,
  refreshQZoneCookiesForBot,
  refreshQZoneCookiesViaBot,
  registerUserViaBot,
  requireBotTenantRole,
  reviewPostViaBot,
  resetPasswordViaBot,
} from "../lib/bot-workflows";
import { parseFriendListCount } from "../lib/bot-friend-stats";
import { writeAuditLog } from "../lib/audit";
import { decryptJson } from "../lib/secret-json";
import { compressImageBuffer, deleteAttachmentObjects, uploadAttachmentBytes, type PostAttachment } from "../lib/attachments";
import { findActiveBan, hasTenantRole } from "../lib/auth";
import { buildCampuxLoginUrl } from "../lib/campux-login-url";
import { prisma } from "../lib/prisma";
import { extractOneBotImageSegments, extractOneBotMessageSegments, extractOneBotPlainText, isPrivatePostCancelText, isPrivatePostFinishText, isPrivatePostUndoText, parsePrivatePostConfirmText, parsePrivatePostModeText, parsePrivatePostStartText, type OneBotMessageSegment } from "../lib/private-posting";
import { analyzePrivatePostSemantics, type PrivatePostSemanticResult } from "../lib/private-posting-ai";
import { readTenantImageCompression, readTenantPendingPostLimit, readTenantBotStylishMessagesEnabled, readTenantBotPrivatePostStylishEnabled } from "../lib/tenant-metadata";
import { imageUploadSourceHardMaxSizeMb, resolveImageUploadLimits, validateProcessedImageSize } from "../lib/image-upload-policy";
import { detectPostInjection, createAutoBan } from "../lib/sanitize";
import { readTenantAiSettings } from "./ai-settings";
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
  formatRegisterAlready,
  formatFirstPrivateMessageRegistrationNotice,
  formatResetPassword,
  formatUndoText,
  formatUndoImages,
  formatQrLoginSuccess,
  formatQrLoginTimeout,
  formatReviewApprovedGroup,
  formatReviewRejectedGroup,
  formatReviewQueueMessages,
  formatRequeue,
  formatPrivatePostModePrompt,
  formatPrivatePostDraftPrompt,
  formatPrivatePostContinuePrompt,
  formatPrivatePostBodyStart,
  formatPrivatePostAppendAck,
  formatPrivatePostConfirmPrompt,
  formatPrivatePostCancelled,
  formatPrivateHelp,
  formatPrivateReplySent,
  formatPrivateReplyReceived,
  formatPrivateReplyNoTarget,
  formatFriendCount,
  formatBotPublishSuccess,
  formatBotPublishHelp,
  formatBotRecallSuccess,
  formatBotRecallFailed,
  formatUnbanSuccess,
  formatUnbanNotFound,
  formatBanNotify,
  formatUnbanNotify,
  escapeCqCode,
} from "../lib/bot-messages";
import { buildFriendRequestAutoApprovePlan, buildSetFriendAddRequestParams, type OneBotRequestEvent } from "./onebot-friend-requests";
import { collectOverdueReviewReminders, listPendingReviewQueue, reviewQueueReminderIntervalMs } from "./review-queue";
import { PrivateRegistrationCoordinator } from "./private-registration";

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
  aiIntakeEnabled: boolean;
};

type PrivatePostPendingMode = {
  tenantId: string;
  text: string;
  attachments: PostAttachment[];
  uploadedKeys: string[];
  updatedAt: number;
  history: PrivatePostHistoryEntry[];
  aiIntakeEnabled: boolean;
  submitAfterModeSelection?: boolean;
};

type PrivatePostPendingConfirm = PrivatePostDraft;

type PrivateForwardEntry = {
  time: number;
  text: string;
  segments: OneBotMessageSegment[];
};

type PrivateForwardBuffer = {
  tenantId: string;
  botQqUin: string;
  userQqUin: string;
  userNickname: string;
  messages: PrivateForwardEntry[];
  timer: Timer | null;
};

type PrivatePostAggregateBuffer = {
  tenantId: string;
  bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null; reviewGroupId: string | null; userMessageReply: string | null; userMessageReplyCooldownSeconds: number };
  botQqUin: string;
  userQqUin: string;
  userNickname: string;
  events: OneBotMessageEvent[];
  messages: PrivateForwardEntry[];
  delayMs: number;
  timer: Timer | null;
  typingTimer: Timer | null;
  userTyping: boolean;
};

type OneBotMessageEvent = {
  post_type?: string;
  request_type?: string;
  notice_type?: string;
  sub_type?: string;
  status?: unknown;
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

const PERMANENT_BAN_ENDS_AT = new Date("9999-12-31T23:59:59.999Z");

const reviewHelp = [
  "审核命令：",
  "#通过 <稿件id>",
  "#全部通过",
  "#审核队列",
  "#拒绝 <理由> <稿件id>",
  "#重发 <稿件id>",
  "#回复 <内容> （引用转发私信后使用）",
  "#发布 <内容> （可附带图片，文字+图片一起发布到空间）",
  "#撤回 [tid] （回复 #发布 成功消息可撤回刚发布的说说）",
  "#封禁 <QQ号> <理由> 或 ban <QQ号> <理由>",
  "#解封 <QQ号> 或 unban <QQ号>",
  "#好友数",
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
  private readonly privateForwardBuffers = new Map<string, PrivateForwardBuffer>();
  private readonly privatePostAggregateBuffers = new Map<string, PrivatePostAggregateBuffer>();
  private readonly privatePostPendingModes = new Map<string, PrivatePostPendingMode>();
  private readonly privatePostPendingConfirms = new Map<string, PrivatePostPendingConfirm>();
  private readonly privatePostDrafts = new Map<string, PrivatePostDraft>();
  private readonly privateRegistrationCoordinator = new PrivateRegistrationCoordinator<{
    registration: Awaited<ReturnType<typeof registerUserViaBot>>;
    createdAccess: boolean;
    noticeSent: boolean;
  }>();
  private readonly privatePasswordResetCoordinator = new PrivateRegistrationCoordinator<Awaited<ReturnType<typeof resetPasswordViaBot>>>();
  private readonly pendingFriendRequestFlags = new Set<string>();
  private readonly privateForwardMsgIdMap = new Map<string, { userQqUin: string; userNickname: string; botQqUin: string }>();
  private static readonly MAX_FORWARD_MSG_ID_MAP_SIZE = 500;
  private readonly qzoneProtocolAutoRefreshFailures = new Map<string, QZoneProtocolAutoRefreshFailure>();
  private readonly qzoneProtocolAutoRefreshInFlight = new Map<string, Promise<{ cookieNames: string[]; session: { id: string } }>>();
  private readonly reviewQueueReminderTimer: Timer | null;
  private reviewQueueReminderRunning = false;

  constructor(
    private readonly queue: RuntimeQueue,
    private readonly logger: FastifyBaseLogger,
    private readonly config?: CampuxConfig,
  ) {
    this.reviewQueueReminderTimer = process.env.NODE_ENV === "test" || this.config?.nodeEnv === "production"
      ? null
      : setInterval(() => {
          this.runReviewQueueReminderScan().catch((error) => {
            this.logger.warn({ error }, "review queue reminder scan failed");
          });
        }, reviewQueueReminderIntervalMs);
  }

  close() {
    if (this.reviewQueueReminderTimer) {
      clearInterval(this.reviewQueueReminderTimer);
    }
  }

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
        logs: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { comment: true },
        },
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
    const channel = post.logs?.some((log) => log.comment.includes("私聊")) ? "private" : "web";
    const lines = formatNewPostReviewNotification(
      post.tenant.name,
      post.displayId,
      post.author.displayName ?? "未命名",
      post.anonymous,
      post.author.qqUin,
      post.text,
      imageCount,
      channel,
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

    await this.sendBotReviewGroupMessage(bot, message, "failed to notify review group");
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
    bot: { platform?: string; qqUin: bigint; officialAppId?: string | null; officialAppSecret?: Prisma.JsonValue | null; displayName?: string; reviewGroupId: string | null },
    message: unknown,
    logMessage: string,
  ) {
    if (!bot.reviewGroupId) {
      return;
    }
    if (bot.platform === "official_qq") {
      return;
    }
    await this.sendGroupMessage(bot.qqUin.toString(), bot.reviewGroupId, message).catch((error) => {
      this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, logMessage);
    });
  }

  private async runReviewQueueReminderScan() {
    if (this.reviewQueueReminderRunning) {
      return;
    }
    this.reviewQueueReminderRunning = true;
    const sentAt = new Date();
    try {
      const reminders = await collectOverdueReviewReminders(prisma, sentAt);
      for (const reminder of reminders) {
        if (!reminder.bot.reviewGroupId) {
          continue;
        }
        try {
          for (const message of reminder.messageChunks) {
            await this.sendGroupMessage(reminder.bot.qqUin.toString(), reminder.bot.reviewGroupId, message);
          }
        } catch (error) {
          this.logger.warn(
            { error, tenantId: reminder.bot.tenantId, botQqUin: reminder.bot.qqUin.toString(), groupId: reminder.bot.reviewGroupId },
            "failed to send review queue reminder",
          );
        }
      }
    } finally {
      this.reviewQueueReminderRunning = false;
    }
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

    if ((event as OneBotMessageEvent).post_type === "notice") {
      this.handlePrivateInputStatusEvent(event as OneBotMessageEvent);
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

  private handlePrivateInputStatusEvent(event: OneBotMessageEvent) {
    const inputStatus = readPrivateInputStatus(event);
    if (!inputStatus) {
      return;
    }
    const botQqUin = normalizeId(event.self_id);
    const userQqUin = normalizeId(event.user_id);
    if (!botQqUin || !userQqUin || botQqUin === userQqUin) {
      return;
    }
    const key = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    const buffer = this.privatePostAggregateBuffers.get(key);
    if (!buffer) {
      return;
    }
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.typingTimer) {
      clearTimeout(buffer.typingTimer);
      buffer.typingTimer = null;
    }
    buffer.userTyping = inputStatus.typing;
    if (inputStatus.typing) {
      buffer.typingTimer = setTimeout(() => {
        buffer.userTyping = false;
        buffer.typingTimer = null;
        this.schedulePrivatePostAggregateFlush(key, buffer);
      }, 15_000);
      return;
    }
    this.schedulePrivatePostAggregateFlush(key, buffer);
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
      if (this.isSkippablePrivateMessage(plainText || event.raw_message || "")) {
        return;
      }
      const loginUrl = await this.resolveCampuxLoginUrl(bot.tenantId);
      const registrationExecution = await this.privateRegistrationCoordinator.run(
        `${bot.tenantId}:${userQqUin}`,
        async () => {
          const result = await registerUserViaBot({
            botQqUin,
            userQqUin,
            displayName: event.sender?.card || event.sender?.nickname || null,
          });
          const createdAccess = !result.alreadyHadTenantAccess;
          let noticeSent = false;
          if (createdAccess) {
            const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
            const message = formatFirstPrivateMessageRegistrationNotice(result, loginUrl, stylishEnabled);
            if (message) {
              await this.sendPrivateMessage(botQqUin, userQqUin, message);
              noticeSent = true;
            }
          }
          return { registration: result, createdAccess, noticeSent };
        },
      );
      const registration = registrationExecution.result.registration;
      const registrationCreatedAccess = registrationExecution.result.createdAccess;
      const registrationNoticeSent = registrationExecution.result.noticeSent;
      const registrationGuidanceHandled = registrationNoticeSent
        || registrationCreatedAccess
        || registrationExecution.lostDatabaseRace;

      // 读取租户 AI 规则：额外投稿关键词与私聊语义收稿开关。
      const aiSettings = await readTenantAiSettings(bot.tenantId);
      const privatePostAiConfigured = aiSettings.rules.privatePostAiEnabled === true;
      const privatePostAiEnabled = isPrivatePostAiIntakeActive(privatePostAiConfigured, aiSettings.mode === "llm" && aiSettings.apiKeyConfigured);
      const privatePostAggregateDelaySeconds = Math.max(0, Math.min(120, Math.trunc(aiSettings.rules.privatePostAggregateDelaySeconds ?? 8)));
      const extraKeywords = aiSettings.rules.postTriggerKeywords;

      const startBody = parsePrivatePostStartText(plainText, {
        extraKeywords,
        aiIntakeEnabled: privatePostAiEnabled,
      });
      if (startBody !== null) {
        this.clearPrivatePostAggregateBuffer(this.getPrivatePostDraftKey(botQqUin, userQqUin));
        await this.startPrivatePostDraft({
          bot,
          botQqUin,
          userQqUin,
          event,
          body: startBody,
          aiIntakeEnabled: privatePostAiEnabled,
        });
        return;
      }

      const draftKey = this.getPrivatePostDraftKey(botQqUin, userQqUin);
      const existingPendingMode = this.privatePostPendingModes.get(draftKey);
      const existingPendingConfirm = this.privatePostPendingConfirms.get(draftKey);
      const existingDraft = this.privatePostDrafts.get(draftKey);
      const semanticForExistingFlow = privatePostAiEnabled && (existingPendingMode || existingPendingConfirm || existingDraft)
        ? await analyzePrivatePostSemantics({
            tenantId: bot.tenantId,
            messageText: plainText,
            currentDraftText: existingPendingMode?.text ?? existingPendingConfirm?.text ?? existingDraft?.text ?? "",
            hasCurrentDraft: true,
            imageCount: (existingPendingMode?.attachments.length ?? existingPendingConfirm?.attachments.length ?? existingDraft?.attachments.length ?? 0) + extractOneBotImageSegments(event.message).length,
            logger: this.logger,
          })
        : undefined;

      const semanticAction = resolvePrivatePostSemanticAction(semanticForExistingFlow);
      if (semanticAction === "cancel") {
        await this.cancelPrivatePostDraft({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      if (shouldRunPrivatePostKeywordCommand(privatePostAiEnabled) && isPrivatePostCancelText(plainText)) {
        await this.cancelPrivatePostDraft({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      const pendingConfirm = existingPendingConfirm;
      if (pendingConfirm) {
        if (semanticAction === "undo") {
          await this.undoPrivatePostDraftEntry({
            bot,
            botQqUin,
            userQqUin,
          });
          return;
        }
        if (shouldRunPrivatePostKeywordCommand(privatePostAiEnabled) && isPrivatePostUndoText(plainText)) {
          await this.undoPrivatePostDraftEntry({
            bot,
            botQqUin,
            userQqUin,
          });
          return;
        }

        const semanticConfirm = privatePostAiEnabled ? shouldConfirmPrivatePostSubmissionFromSemantic(semanticForExistingFlow) : null;
        const keywordConfirm = shouldRunPrivatePostKeywordCommand(privatePostAiEnabled) ? parsePrivatePostConfirmText(plainText) : null;
        const confirmation = semanticConfirm ?? keywordConfirm;
        if (confirmation?.confirmed === true) {
          await this.submitPrivatePostPendingConfirm({
            bot,
            botQqUin,
            userQqUin,
          });
          return;
        }
        if (confirmation?.confirmed === false) {
          await this.cancelPrivatePostDraft({
            bot,
            botQqUin,
            userQqUin,
          });
          return;
        }

        const shouldAppendContent = privatePostAiEnabled && shouldAppendPrivatePostContentForSemantic(semanticForExistingFlow);
        const appended = shouldAppendContent
          ? await this.appendPrivatePostContent({ bot, botQqUin, userQqUin, event, target: pendingConfirm, semantic: semanticForExistingFlow })
          : false;
        await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostConfirmPrompt(pendingConfirm.text, pendingConfirm.attachments.length, pendingConfirm.aiIntakeEnabled));
        if (!appended) {
          return;
        }
        return;
      }

      if (semanticAction === "undo") {
        await this.undoPrivatePostDraftEntry({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      if (shouldRunPrivatePostKeywordCommand(privatePostAiEnabled) && isPrivatePostUndoText(plainText)) {
        await this.undoPrivatePostDraftEntry({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      const pendingMode = existingPendingMode;
      if (pendingMode) {
        const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
        const semantic = semanticForExistingFlow;
        const semanticModeSelection = resolvePrivatePostModeSelectionFromSemantic(semantic);
        if (semanticModeSelection !== null) {
          await this.selectPrivatePostMode({
            bot,
            botQqUin,
            userQqUin,
            anonymous: semanticModeSelection.anonymous,
          });
          return;
        }

        if (semanticAction === "submit") {
          await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostModePrompt(privateStylishEnabled, pendingMode.aiIntakeEnabled === true));
          return;
        }
        if (shouldRunPrivatePostKeywordCommand(privatePostAiEnabled) && isPrivatePostFinishText(plainText)) {
          await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostModePrompt(privateStylishEnabled, pendingMode.aiIntakeEnabled === true));
          return;
        }

        if (shouldRunPrivatePostKeywordCommand(privatePostAiEnabled)) {
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
        }

        const shouldAppendContent = privatePostAiEnabled && shouldAppendPrivatePostContentForSemantic(semantic);
        if (shouldAppendContent) {
          await this.appendPrivatePostContent({ bot, botQqUin, userQqUin, event, target: pendingMode, semantic });
        }
        await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostModePrompt(privateStylishEnabled, pendingMode.aiIntakeEnabled === true));
        return;
      }

      if (shouldRunPrivatePostKeywordCommand(privatePostAiEnabled) && isPrivatePostFinishText(plainText)) {
        await this.requestPrivatePostSubmitConfirmation({
          bot,
          botQqUin,
          userQqUin,
        });
        return;
      }

      const draft = existingDraft;
      if (draft) {
        const semantic = semanticForExistingFlow;

        if (semantic?.intent === "post" && semantic.anonymous !== null) {
          draft.anonymous = semantic.anonymous;
        }

        const shouldSubmitBySemantic = semanticAction === "submit" || (semantic?.intent === "post" && semantic.shouldSubmit);
        const semanticText = semantic?.text;
        if (shouldSubmitBySemantic && semanticText && shouldApplyPrivatePostSemanticText(semantic)) {
          draft.text = semanticText;
        }

        const shouldAppendContent = shouldAppendPrivatePostContentForSemantic(semantic);
        const appended = shouldAppendContent
          ? await this.appendPrivatePostContent({ bot, botQqUin, userQqUin, event, target: draft, semantic })
          : false;
        if (shouldSubmitBySemantic) {
          await this.requestPrivatePostSubmitConfirmation({
            bot,
            botQqUin,
            userQqUin,
          });
          return;
        }
        if (appended) {
          const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
          await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostAppendAck(privateStylishEnabled));
          return;
        }

        return;
      }

      const command = parsePrivateCommand(plainText);
      if (!command) {
        if (privatePostAiEnabled && privatePostAggregateDelaySeconds > 0) {
          this.bufferPrivatePostAggregateMessage({
            bot,
            botQqUin,
            userQqUin,
            userNickname: event.sender?.card || event.sender?.nickname || userQqUin,
            event,
            delaySeconds: privatePostAggregateDelaySeconds,
          });
          return;
        }

        if (privatePostAiEnabled) {
          const semantic = await analyzePrivatePostSemantics({
            tenantId: bot.tenantId,
            messageText: plainText,
            hasCurrentDraft: false,
            imageCount: extractOneBotImageSegments(event.message).length,
            logger: this.logger,
          });
          if (semantic.intent === "post" && semantic.confidence >= 0.55 && (semantic.text || extractOneBotImageSegments(event.message).length > 0)) {
            await this.startPrivatePostDraft({
              bot,
              botQqUin,
              userQqUin,
              event,
              body: semantic.text || plainText,
              semantic,
              aiIntakeEnabled: true,
            });
            return;
          }
        }

// 跳过好友请求等系统消息，不转发
        if (this.isSkippablePrivateMessage(plainText || event.raw_message || "")) {
          return;
        }

        // 跳过 "我是<昵称>" 的自我介绍消息
        const senderNickname = event.sender?.card || event.sender?.nickname;
        if (senderNickname && this.isSelfIntroMessage(plainText, senderNickname)) {
          return;
        }

        const isStickerOnly = this.isStickerOnlyMessage(event);

        // 非投稿、非命令消息：缓存到缓冲区，1 分钟无新消息后合并转发到审核群
        if (bot.reviewGroupId) {
          this.bufferPrivateForwardMessage({
            bot,
            botQqUin,
            userQqUin,
            userNickname: event.sender?.card || event.sender?.nickname || userQqUin,
            text: plainText || event.raw_message || "（不支持的消息类型）",
            segments: extractOneBotMessageSegments(event.message),
          });
        }

        // 纯表情包消息不自动回复，避免骚扰用户
        if (isStickerOnly) {
          return;
        }

        // 保留原有自动回复
        if (!registrationGuidanceHandled && this.shouldSendPrivateAutoReply(bot.id, userQqUin, bot.userMessageReplyCooldownSeconds)) {
          const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
          await this.sendPrivateMessage(botQqUin, userQqUin, bot.userMessageReply || formatPrivateHelp(stylishEnabled)).catch(() => undefined);
        }
        return;
      }

      if (command.name === "注册账号") {
        if (registrationGuidanceHandled) {
          return;
        }
        const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
        await this.sendPrivateMessage(botQqUin, userQqUin, formatRegisterAlready(loginUrl, stylishEnabled));
        return;
      }
      if (command.name === "重置密码") {
        if (registration.password || registrationExecution.lostDatabaseRace) {
          return;
        }
        const reset = await this.privatePasswordResetCoordinator.run(
          `${bot.tenantId}:${userQqUin}`,
          () => resetPasswordViaBot({ botQqUin, userQqUin }),
        );
        if (!reset.shouldAnnounce) {
          return;
        }
        const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
        await this.sendPrivateMessage(botQqUin, userQqUin, formatResetPassword(reset.result.password, stylishEnabled));
        return;
      }

      if (registrationGuidanceHandled) {
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

  private async resolveCampuxLoginUrl(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { host: true },
    });
    return buildCampuxLoginUrl(tenant?.host, this.config?.webOrigin ?? "http://localhost:5180");
  }

  private async startPrivatePostDraft({
    bot,
    botQqUin,
    userQqUin,
    event,
    body,
    semantic,
    aiIntakeEnabled = false,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
    event: OneBotMessageEvent;
    body: string;
    semantic?: PrivatePostSemanticResult | undefined;
    aiIntakeEnabled?: boolean;
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
    const text = (semantic?.intent === "post" && semantic.text ? semantic.text : body).trim();
    const attachments = staged.attachments;
    const history: PrivatePostHistoryEntry[] = [];
    if (text) {
      history.push({ type: "text", text });
    }
    if (attachments.length > 0) {
      history.push({ type: "images", attachmentCount: attachments.length, uploadedKeys: staged.uploadedKeys });
    }
    if (semantic?.intent === "post" && semantic.anonymous !== null) {
      this.privatePostDrafts.set(draftKey, {
        tenantId: bot.tenantId,
        text,
        anonymous: semantic.anonymous,
        attachments,
        uploadedKeys: staged.uploadedKeys,
        updatedAt: Date.now(),
        history,
        aiIntakeEnabled,
      });
      if (semantic.shouldSubmit) {
        await this.requestPrivatePostSubmitConfirmation({ bot, botQqUin, userQqUin });
        return;
      }
      const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
      await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostBodyStart(privateStylishEnabled, aiIntakeEnabled));
      return;
    }

    this.privatePostPendingModes.set(draftKey, {
      tenantId: bot.tenantId,
      text,
      attachments,
      uploadedKeys: staged.uploadedKeys,
      updatedAt: Date.now(),
      history,
      aiIntakeEnabled,
      submitAfterModeSelection: shouldSubmitPrivatePostAfterModeSelection(semantic),
    });

    const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
    const summary = this.formatPrivatePostPendingSummary(text, attachments.length, privateStylishEnabled, aiIntakeEnabled);
    await this.sendPrivateMessage(botQqUin, userQqUin, summary);
  }

  private async appendPrivatePostContent({
    bot,
    botQqUin,
    userQqUin,
    event,
    target,
    semantic,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null };
    botQqUin: string;
    userQqUin: string;
    event: OneBotMessageEvent;
    target: PrivatePostDraft | PrivatePostPendingMode | PrivatePostPendingConfirm;
    semantic?: PrivatePostSemanticResult | undefined;
  }) {
    await this.ensurePrivatePostingAllowed(bot.tenantId, userQqUin);

    const rawDraftText = extractOneBotPlainText(event.message, event.raw_message).trim();
    const draftText = semantic?.intent === "post" ? this.extractSemanticAppendText(target.text, semantic.text) : rawDraftText;
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

    const pendingConfirm = this.privatePostPendingConfirms.get(draftKey);
    if (pendingConfirm) {
      await this.clearPrivatePostPendingConfirm(draftKey);
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

  private async requestPrivatePostSubmitConfirmation({
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
    if (!text && draft.attachments.length === 0) {
      await this.sendPrivateMessage(botQqUin, userQqUin, draft.aiIntakeEnabled ? "请先发送稿件正文或图片，再确认提交。" : "请先发送稿件正文或图片，再发送 #结束。");
      return;
    }
    if (text.length > 1_000) {
      await this.sendPrivateMessage(botQqUin, userQqUin, draft.aiIntakeEnabled ? "正文太长了，请控制在 1000 字以内，再确认提交。" : "正文太长了，请控制在 1000 字以内，再发送 #结束。");
      return;
    }

    this.privatePostDrafts.delete(draftKey);
    this.privatePostPendingConfirms.set(draftKey, {
      ...draft,
      text,
      updatedAt: Date.now(),
    });
    await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostConfirmPrompt(text, draft.attachments.length, draft.aiIntakeEnabled));
  }

  private async submitPrivatePostPendingConfirm({
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
    const pending = this.privatePostPendingConfirms.get(draftKey);
    if (!pending) {
      await this.sendPrivateMessage(botQqUin, userQqUin, "还没有等待确认的投稿。");
      return;
    }

    const result = await this.createPostFromPrivateDraft(bot, userQqUin, pending).catch(async (error) => {
      if (error instanceof BotWorkflowError) {
        await this.sendPrivateMessage(botQqUin, userQqUin, error.message).catch(() => undefined);
        return null;
      }
      throw error;
    });
    if (!result) {
      return;
    }

    const { post } = result;
    this.privatePostPendingConfirms.delete(draftKey);
    const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
    await this.sendPrivateMessage(botQqUin, userQqUin, formatSubmissionSuccess(post.displayId, stylishEnabled));
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

  private async clearPrivatePostPendingConfirm(draftKey: string) {
    const existing = this.privatePostPendingConfirms.get(draftKey);
    if (!existing) {
      return;
    }
    this.privatePostPendingConfirms.delete(draftKey);
    if (this.config && existing.uploadedKeys.length > 0) {
      await deleteAttachmentObjects(this.config, existing.uploadedKeys).catch((error) => {
        this.logger.warn({ error, draftKey }, "failed to cleanup pending private post confirm attachments");
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
    const imageUploadLimits = resolveImageUploadLimits({
      maxSizeMb: compression.maxSizeMb,
      compressionEnabled: compression.enabled,
    });
    const attachments: PostAttachment[] = [];
    const uploadedKeys: string[] = [];

    try {
      for (const segment of imageSegments) {
        const source = await this.resolvePrivatePostImageSource(bot.qqUin.toString(), segment);
        if (source.bytes.length > imageUploadLimits.sourceMaxBytes) {
          const message = compression.enabled
            ? `图片原图不能超过 ${imageUploadSourceHardMaxSizeMb}MB，无法自动压缩`
            : `图片不能超过 ${compression.maxSizeMb}MB`;
          throw new BotWorkflowError(message, 413);
        }
        const fileName = source.fileName || normalizeImageFileName(source.url) || "attachment.jpg";
        const compressed = await compressImageBuffer(source.bytes, source.contentType, compression);
        const sizeValidation = validateProcessedImageSize(compressed.byteLength, compression.maxSizeMb);
        if (!sizeValidation.ok) {
          throw new BotWorkflowError(sizeValidation.message, sizeValidation.status);
        }
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

  private async resolveReviewGroupImageSource(botQqUin: string, segment: { data?: Record<string, unknown> }) {
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

  private formatPrivatePostDraftSummary(text: string, attachmentCount: number, anonymous: boolean, stylishEnabled = false, aiIntakeEnabled = false) {
    void text;
    void attachmentCount;
    void anonymous;
    return formatPrivatePostDraftPrompt(stylishEnabled, aiIntakeEnabled);
  }

  private formatPrivatePostPendingSummary(text: string, attachmentCount: number, stylishEnabled = false, aiIntakeEnabled = false) {
    void text;
    void attachmentCount;
    return formatPrivatePostModePrompt(stylishEnabled, aiIntakeEnabled);
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
      aiIntakeEnabled: pending.aiIntakeEnabled,
    });

    if (pending.submitAfterModeSelection) {
      await this.requestPrivatePostSubmitConfirmation({ bot, botQqUin, userQqUin });
      return;
    }

    const privateStylishEnabled = await readTenantBotPrivatePostStylishEnabled(prisma, bot.tenantId);
    await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostBodyStart(privateStylishEnabled, pending.aiIntakeEnabled === true));
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
        await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostModePrompt(privateStylishEnabled, pending.aiIntakeEnabled === true));
        return;
      }
      await this.sendPrivateMessage(botQqUin, userQqUin, this.formatPrivatePostPendingSummary(pending.text, pending.attachments.length, privateStylishEnabled, pending.aiIntakeEnabled === true));
      return;
    }

    const pendingConfirm = this.privatePostPendingConfirms.get(draftKey);
    if (pendingConfirm) {
      const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);
      await this.popPrivatePostHistoryEntry(draftKey, pendingConfirm, stylishEnabled);
      await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostConfirmPrompt(pendingConfirm.text, pendingConfirm.attachments.length, pendingConfirm.aiIntakeEnabled));
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
      await this.sendPrivateMessage(botQqUin, userQqUin, formatPrivatePostDraftPrompt(privateStylishEnabled, draft.aiIntakeEnabled === true));
      return;
    }
    await this.sendPrivateMessage(botQqUin, userQqUin, this.formatPrivatePostDraftSummary(draft.text, draft.attachments.length, draft.anonymous, privateStylishEnabled, draft.aiIntakeEnabled === true));
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

  private extractSemanticAppendText(currentText: string, semanticText: string) {
    const current = currentText.trim();
    const next = semanticText.trim();
    if (!next) {
      return "";
    }
    if (!current) {
      return next;
    }
    if (next === current) {
      return "";
    }
    if (next.startsWith(current)) {
      return next.slice(current.length).replace(/^\s+/, "").trim();
    }
    return next;
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

    // 注入检测：XSS、CSS、代码、CQ 码
    const injectionResult = detectPostInjection({ text });
    if (injectionResult.detected) {
      // 自动封禁一天
      await createAutoBan({
        tenantId: bot.tenantId,
        userId: access.operator.id,
        operatorId: access.operator.id,
        reason: injectionResult.reason,
        onBan: async (userId, allTenantIds, endsAt) => {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          if (!user) return;
          const tenant = await prisma.tenant.findUnique({ where: { id: bot.tenantId } });
          const tenantName = tenant?.name ?? "校园墙";
          const qqUin = user.qqUin.toString();
          await this.sendPrivateMessageViaTenantBots(bot.tenantId, qqUin, formatBanNotify(tenantName, injectionResult.reason, endsAt));
        },
      }).catch((banErr: unknown) => {
        this.logger.warn({ error: banErr }, "failed to create auto ban");
      });

      throw new BotWorkflowError(`投稿包含不安全内容，账号已被封禁 24 小时：${injectionResult.reason}`, 403);
    }

    const initialStatus = "pending_approval";
    const logComment = "QQ 私聊投稿创建";

    let post: Awaited<ReturnType<typeof prisma.post.create>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        post = await prisma.$transaction(
          async (tx) => {
            if (initialStatus === "pending_approval") {
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
                status: initialStatus,
                logs: {
                  create: {
                    tenantId: bot.tenantId,
                    actorId: access.operator.id,
                    newStatus: initialStatus,
                    comment: logComment,
                  },
                },
              },
            });
          },
          { isolationLevel: TransactionIsolationLevel.Serializable },
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

    if (shouldNotifyReviewGroupAfterPrivatePostCreate(post)) {
      await this.notifyNewPost(post.id).catch((error) => {
        this.logger.warn({ error, postId: post.id }, "failed to notify review group from private post");
      });
    }

    return { post };
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

    let command = parseReviewGroupCommand(extractPlainText(event));

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

    // 如果消息 @ 了其他 bot 但不是当前 bot，跳过（对应 bot 会处理）。未 @ 的审核群命令只由租户首选审核通知 Bot 响应，避免多 Bot 重复回复。
    if (!shouldHandleReviewGroupCommandForBot({
      currentBotId: bot.id,
      currentBotQqUin: botQqUin,
      mentionedBotQqUins: readMentionedQqUins(event),
      preferredBotId: await this.findTenantReviewNotificationBot(bot.tenantId).then((candidate) => candidate?.id ?? null),
    })) {
      return;
    }

    try {
      const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, bot.tenantId);

      if (command.name === "全部通过") {
        const result = await approveAllPendingPostsViaBot({
          queue: this.queue,
          botQqUin,
          groupId,
          operatorQqUin,
        });
        await this.sendGroupMessage(botQqUin, groupId, result.approved === 0 ? "当前没有待审核稿件" : `已全部通过 ${result.approved} 条待审核稿件`);
        await Promise.all(result.approvedPostIds.map((postId) => this.notifyReviewResult(postId, "approved").catch(() => undefined)));
        return;
      }

      if (["审核队列", "待审核", "队列"].includes(command.name)) {
        await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");
        const queueSnapshot = await listPendingReviewQueue(prisma, bot.tenantId);
        for (const message of formatReviewQueueMessages(queueSnapshot.items, new Date(), queueSnapshot.hiddenCount)) {
          await this.sendGroupMessage(botQqUin, groupId, message);
        }
        return;
      }

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

      if (command.name === "回复") {
        await this.handlePrivateReply({
          bot,
          botQqUin,
          groupId,
          event,
          replyText: command.args,
          stylishEnabled,
        });
        return;
      }

      if (["好友数", "好友数量"].includes(command.name)) {
        await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");
        const data = await this.callAction(botQqUin, "get_friend_list", {}, 45_000);
        const friendCount = parseFriendListCount(data);
        if (friendCount === null) {
          await this.sendGroupMessage(botQqUin, groupId, "获取好友列表失败，返回数据格式异常");
          return;
        }
        await this.sendGroupMessage(botQqUin, groupId, formatFriendCount(bot.displayName ?? `QQ ${botQqUin}`, friendCount, stylishEnabled));
        return;
      }

      if (command.name === "发布") {
        const publishText = command.args.trim();
        if (!publishText) {
          await this.sendGroupMessage(botQqUin, groupId, formatBotPublishHelp(stylishEnabled));
          return;
        }
        if (publishText.length > 1_000) {
          await this.sendGroupMessage(botQqUin, groupId, "发布内容太长，请控制在 1000 字以内");
          return;
        }
        // 提取消息中的图片
        const imageSegments = extractOneBotImageSegments(event.message);
        let images: Array<{ name: string; bytes: Uint8Array }> | undefined;
        if (imageSegments.length > 0) {
          if (imageSegments.length > 9) {
            await this.sendGroupMessage(botQqUin, groupId, "最多 9 张图片");
            return;
          }
          images = [];
          for (const segment of imageSegments) {
            const source = await this.resolveReviewGroupImageSource(botQqUin, segment);
            images.push({ name: source.fileName || "image.jpg", bytes: source.bytes });
          }
        }
        const result = await publishTextDirectViaBot({
          botQqUin,
          groupId,
          operatorQqUin,
          text: publishText,
          ...(images ? { images } : {}),
        });
        await this.sendGroupMessage(botQqUin, groupId, formatBotPublishSuccess(stylishEnabled, result.qzoneTid ?? undefined));
        return;
      }

      if (["封禁", "ban"].includes(command.name)) {
        const { operator } = await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");
        const parsed = parseBanCommandArgs(command.args);
        if (!parsed) {
          await this.sendGroupMessage(botQqUin, groupId, "请提供要封禁的 QQ 号和理由，例如：#封禁 123456789 刷屏广告 或 ban 123456789 刷屏广告");
          return;
        }
        const targetUser = await prisma.user.findUnique({
          where: { qqUin: BigInt(parsed.qqUin) },
        });
        if (!targetUser) {
          await this.sendGroupMessage(botQqUin, groupId, `未找到 QQ ${parsed.qqUin} 对应的账号，请先让该账号通过 Bot 注册或由运维创建`);
          return;
        }
        const membership = await prisma.tenantMembership.findUnique({
          where: {
            tenantId_userId: {
              tenantId: bot.tenantId,
              userId: targetUser.id,
            },
          },
        });
        if (!membership) {
          await this.sendGroupMessage(botQqUin, groupId, "该用户不属于当前校园墙");
          return;
        }
        if (membership.role === "admin") {
          await this.sendGroupMessage(botQqUin, groupId, "不能封禁管理员");
          return;
        }
        const endsAt = new Date(PERMANENT_BAN_ENDS_AT);
        await prisma.banRecord.create({
          data: {
            tenantId: bot.tenantId,
            userId: targetUser.id,
            operatorId: operator.id,
            comment: parsed.reason,
            endsAt,
          },
        });
        await writeAuditLog({
          tenantId: bot.tenantId,
          actorId: operator.id,
          action: "ban.create",
          targetType: "user",
          targetId: targetUser.id,
          detail: {
            comment: parsed.reason,
            endsAt: endsAt.toISOString(),
            source: "review_group",
          },
        });
        await this.sendGroupMessage(botQqUin, groupId, `已封禁 QQ ${parsed.qqUin}，理由：${parsed.reason}`);
        const tenant = await prisma.tenant.findUnique({ where: { id: bot.tenantId } });
        const tenantName = tenant?.name ?? "校园墙";
        await this.sendPrivateMessageViaTenantBots(bot.tenantId, parsed.qqUin, formatBanNotify(tenantName, parsed.reason, endsAt)).catch((error) => {
          this.logger.warn({ error, qqUin: parsed.qqUin }, "failed to send ban notification");
        });
        return;
      }

      if (["解封", "unban"].includes(command.name)) {
        const { operator } = await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");
        const parsed = parseUnbanCommandArgs(command.args);
        if (!parsed) {
          await this.sendGroupMessage(botQqUin, groupId, "请提供要解封的 QQ 号，例如：#解封 123456789");
          return;
        }
        const qqUin = parsed.qqUin;
        const targetUser = await prisma.user.findUnique({
          where: { qqUin: BigInt(qqUin) },
        });
        if (!targetUser) {
          await this.sendGroupMessage(botQqUin, groupId, formatUnbanNotFound(qqUin, stylishEnabled));
          return;
        }
        const activeBan = await findActiveBan(bot.tenantId, targetUser.id);
        if (!activeBan) {
          await this.sendGroupMessage(botQqUin, groupId, formatUnbanNotFound(qqUin, stylishEnabled));
          return;
        }
        await prisma.banRecord.update({
          where: { id: activeBan.id },
          data: { endsAt: new Date() },
        });
        await writeAuditLog({
          tenantId: bot.tenantId,
          actorId: operator.id,
          action: "ban.unban",
          targetType: "user",
          targetId: targetUser.id,
        });
        await this.sendGroupMessage(botQqUin, groupId, formatUnbanSuccess(qqUin, stylishEnabled));
        // 发私信通知用户已解封
        const tenant = await prisma.tenant.findUnique({ where: { id: bot.tenantId } });
        const tenantName = tenant?.name ?? "校园墙";
        await this.sendPrivateMessageViaTenantBots(bot.tenantId, qqUin, formatUnbanNotify(tenantName)).catch((error) => {
          this.logger.warn({ error, qqUin }, "failed to send unban notification");
        });
        return;
      }

      if (command.name === "撤回") {
        await requireBotTenantRole(bot.tenantId, operatorQqUin, "reviewer");

        // 尝试从回复消息中提取 qzoneTid
        let qzoneTid: string | null = command.args.trim();
        if (!qzoneTid) {
          // 如果 #撤回 没有带参数，尝试从回复的 bot 消息中提取
          qzoneTid = await this.tryResolveQZoneTidFromReply(event, botQqUin);
        }
        if (!qzoneTid) {
          await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
          return;
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
          await this.sendGroupMessage(botQqUin, groupId, formatBotRecallFailed("机器人 QZone 登录态不可用", stylishEnabled));
          return;
        }

        const cookies = decryptJson(session.cookies) as Record<string, string> | null;
        if (!cookies) {
          await this.sendGroupMessage(botQqUin, groupId, formatBotRecallFailed("QZone cookies 解析失败", stylishEnabled));
          return;
        }

        try {
          await setQZoneEmotionPrivate({
            targetName: bot.displayName ?? `QQ ${botQqUin}`,
            externalId: qzoneTid,
            cookies,
          });
          await this.sendGroupMessage(botQqUin, groupId, formatBotRecallSuccess(stylishEnabled));
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          await this.sendGroupMessage(botQqUin, groupId, formatBotRecallFailed(message, stylishEnabled));
        }
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

  private bufferPrivatePostAggregateMessage({
    bot,
    botQqUin,
    userQqUin,
    userNickname,
    event,
    delaySeconds,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null; reviewGroupId: string | null; userMessageReply: string | null; userMessageReplyCooldownSeconds: number };
    botQqUin: string;
    userQqUin: string;
    userNickname: string;
    event: OneBotMessageEvent;
    delaySeconds: number;
  }) {
    const key = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    let buffer = this.privatePostAggregateBuffers.get(key);
    const text = extractOneBotPlainText(event.message, event.raw_message).trim() || event.raw_message || "（不支持的消息类型）";
    if (!buffer) {
      buffer = {
        tenantId: bot.tenantId,
        bot,
        botQqUin,
        userQqUin,
        userNickname,
        events: [],
        messages: [],
        delayMs: delaySeconds * 1000,
        timer: null,
        typingTimer: null,
        userTyping: false,
      };
      this.privatePostAggregateBuffers.set(key, buffer);
    }
    buffer.bot = bot;
    buffer.userNickname = userNickname;
    buffer.delayMs = delaySeconds * 1000;
    buffer.events.push(event);
    buffer.messages.push({ time: Math.floor(Date.now() / 1000), text, segments: extractOneBotMessageSegments(event.message) });
    this.schedulePrivatePostAggregateFlush(key, buffer);
  }

  private schedulePrivatePostAggregateFlush(key: string, buffer: PrivatePostAggregateBuffer) {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.userTyping) {
      return;
    }
    buffer.timer = setTimeout(() => {
      this.flushPrivatePostAggregateBuffer(key).catch((error) => {
        this.logger.warn({ error, botQqUin: buffer.botQqUin, userQqUin: buffer.userQqUin }, "AI 聚合私聊投稿失败");
      });
    }, buffer.delayMs);
  }

  private clearPrivatePostAggregateBuffer(key: string) {
    const buffer = this.privatePostAggregateBuffers.get(key);
    if (!buffer) return;
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }
    if (buffer.typingTimer) {
      clearTimeout(buffer.typingTimer);
    }
    this.privatePostAggregateBuffers.delete(key);
  }

  private async flushPrivatePostAggregateBuffer(key: string) {
    const buffer = this.privatePostAggregateBuffers.get(key);
    if (!buffer || buffer.events.length === 0) {
      this.privatePostAggregateBuffers.delete(key);
      return;
    }
    this.clearPrivatePostAggregateBuffer(key);
    if (this.privatePostDrafts.has(key) || this.privatePostPendingModes.has(key) || this.privatePostPendingConfirms.has(key)) {
      return;
    }

    const messageText = buffer.messages.map((entry) => entry.text).filter(Boolean).join("\n").trim();
    const imageCount = buffer.events.reduce((count, item) => count + extractOneBotImageSegments(item.message).length, 0);
    const semantic = await analyzePrivatePostSemantics({
      tenantId: buffer.tenantId,
      messageText,
      hasCurrentDraft: false,
      imageCount,
      logger: this.logger,
    });
    if (semantic.intent === "post" && semantic.confidence >= 0.55 && (semantic.text || imageCount > 0)) {
      await this.startPrivatePostDraft({
        bot: buffer.bot,
        botQqUin: buffer.botQqUin,
        userQqUin: buffer.userQqUin,
        event: mergePrivatePostAggregateEvents(buffer.events, messageText),
        body: messageText,
        semantic,
        aiIntakeEnabled: true,
      });
      return;
    }

    if (this.isSkippablePrivateMessage(messageText)) {
      return;
    }

    // 跳过纯表情包消息
    const firstEvent = buffer.events[0];
    if (firstEvent && this.isStickerOnlyMessage(firstEvent)) {
      return;
    }

    // 跳过 "我是<昵称>" 的自我介绍消息
    if (buffer.userNickname && this.isSelfIntroMessage(messageText, buffer.userNickname)) {
      return;
    }

    if (buffer.bot.reviewGroupId) {
      for (const entry of buffer.messages) {
        this.bufferPrivateForwardMessage({
          bot: buffer.bot,
          botQqUin: buffer.botQqUin,
          userQqUin: buffer.userQqUin,
          userNickname: buffer.userNickname,
          text: entry.text,
          segments: entry.segments,
        });
      }
    }
    if (this.shouldSendPrivateAutoReply(buffer.bot.id, buffer.userQqUin, buffer.bot.userMessageReplyCooldownSeconds)) {
      const stylishEnabled = await readTenantBotStylishMessagesEnabled(prisma, buffer.tenantId);
      await this.sendPrivateMessage(buffer.botQqUin, buffer.userQqUin, buffer.bot.userMessageReply || formatPrivateHelp(stylishEnabled)).catch(() => undefined);
    }
  }

  private bufferPrivateForwardMessage({
    bot,
    botQqUin,
    userQqUin,
    userNickname,
    text,
    segments,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null; reviewGroupId: string | null };
    botQqUin: string;
    userQqUin: string;
    userNickname: string;
    text: string;
    segments?: OneBotMessageSegment[];
  }) {
    // 异步递增私信接收计数
    prisma.botAccount.update({
      where: { id: bot.id },
      data: { privateMessagesReceived: { increment: 1 } },
    }).catch((error) => {
      this.logger.warn({ error, botId: bot.id }, "failed to increment private message counter");
    });

    const key = this.getPrivatePostDraftKey(botQqUin, userQqUin);
    let buffer = this.privateForwardBuffers.get(key);
    if (!buffer) {
      buffer = {
        tenantId: bot.tenantId,
        botQqUin,
        userQqUin,
        userNickname,
        messages: [],
        timer: null,
      };
      this.privateForwardBuffers.set(key, buffer);
    }

    buffer.messages.push({
      time: Math.floor(Date.now() / 1000),
      text,
      segments: segments ?? [],
    });

    // 重置计时器：最后一条消息后等待 1 分钟
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }
    buffer.timer = setTimeout(() => {
      this.flushPrivateForwardBuffer(key).catch((error) => {
        this.logger.warn({ error, botQqUin, userQqUin }, "合并转发私聊消息到审核群失败");
      });
    }, 60_000);
  }

  private async flushPrivateForwardBuffer(key: string) {
    const buffer = this.privateForwardBuffers.get(key);
    if (!buffer || buffer.messages.length === 0) {
      this.privateForwardBuffers.delete(key);
      return;
    }

    // 清除定时器
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    // 提前从 Map 删除，防止重复触发
    this.privateForwardBuffers.delete(key);

    try {
      // 重新获取 bot 信息以获取最新的 reviewGroupId
      const bot = await findEnabledBot(buffer.botQqUin).catch(() => null);
      if (!bot?.reviewGroupId) {
        return;
      }

      // 构建合并转发消息节点
      const nodes: Array<{
        type: "node";
        data: {
          name: string;
          uin: string;
          time?: number;
          content: OneBotMessageSegment[];
        };
      }> = [];

      for (const entry of buffer.messages) {
        // 如果保留了原始消息段（face/image 等），直接使用；否则降级为纯文本
        // 合并转发中不支持的段（mface/marketface/markdown）替换为文本提示
        const rawSegments =
          entry.segments.length > 0
            ? entry.segments
            : [{ type: "text", data: { text: entry.text } }];
        const content = this.sanitizeForwardSegments(rawSegments);

        nodes.push({
          type: "node",
          data: {
            name: buffer.userNickname,
            uin: buffer.userQqUin,
            time: entry.time,
            content,
          },
        });
      }

      // 使用合并转发发送
      let msgId: string | null = null;
      try {
        const data = await this.callAction(buffer.botQqUin, "send_group_forward_msg", {
          group_id: Number(bot.reviewGroupId),
          messages: nodes,
        });
        msgId = this.extractMessageId(data);
      } catch (error) {
        // 合并转发失败时降级为普通消息
        this.logger.warn({ error, botQqUin: buffer.botQqUin, userQqUin: buffer.userQqUin }, "合并转发失败，降级为普通消息发送");
        const lines = [
          `📩 ${buffer.userNickname}（${buffer.userQqUin}）发来私聊消息：`,
          ...buffer.messages.map((entry, i) => `${i + 1}. ${escapeCqCode(entry.text)}`),
        ];
        const fallbackData = await this.callAction(buffer.botQqUin, "send_group_msg", {
          group_id: Number(bot.reviewGroupId),
          message: lines.join("\n"),
        });
        msgId = this.extractMessageId(fallbackData);
      }

      if (msgId) {
        this.storePrivateForwardMapping(msgId, buffer.userQqUin, buffer.userNickname, buffer.botQqUin);
      }
    } catch (error) {
      this.logger.warn({ error, botQqUin: buffer.botQqUin, userQqUin: buffer.userQqUin }, "转发私聊消息到审核群失败");
    }
  }

  /**
   * 清理合并转发节点中可能不被 QQ 支持的段。
   * mface（商城表情/超级表情）、marketface image、markdown 等在合并转发中可能显示为
   * "此消息不支持查看"。将这些段替换为文本提示，保留其他段不变。
   */
  private sanitizeForwardSegments(segments: OneBotMessageSegment[]): OneBotMessageSegment[] {
    return segments.flatMap((seg) => {
      // mface 类型段（商城表情/超级表情）
      if (seg.type === "mface") {
        const summary = String(seg.data?.summary ?? "[超级表情]");
        return [{ type: "text", data: { text: `[${summary}]` } }];
      }
      // image 中的 marketface（商城表情以 image 段上报）
      if (seg.type === "image" && String(seg.data?.file ?? "") === "marketface") {
        const summary = String(seg.data?.summary ?? "[商城表情]");
        return [{ type: "text", data: { text: `[${summary}]` } }];
      }
      // markdown 段在双层合并转发中无法发送
      if (seg.type === "markdown") {
        return [{ type: "text", data: { text: "[Markdown消息]" } }];
      }
      return [seg];
    });
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

  private async tryResolveQZoneTidFromReply(event: OneBotMessageEvent, botQqUin: string): Promise<string | null> {
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

      // Extract text from the replied message
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

      // Extract qzoneTid from pattern `tid:xxxxx`
      const m = text.match(/tid:(\S+)/);
      return m ? (m[1] ?? null) : null;
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

  private async handlePrivateReply({
    bot,
    botQqUin,
    groupId,
    event,
    replyText,
    stylishEnabled,
  }: {
    bot: { id: string; tenantId: string; qqUin: bigint; displayName?: string | null; reviewGroupId: string | null };
    botQqUin: string;
    groupId: string;
    event: OneBotMessageEvent;
    replyText: string;
    stylishEnabled: boolean;
  }) {
    const text = replyText.trim();
    if (!text) {
      await this.sendGroupMessage(botQqUin, groupId, formatPrivateReplyNoTarget(stylishEnabled));
      return;
    }

    const replyToMsgId = this.extractReplyMessageId(event);
    if (!replyToMsgId) {
      await this.sendGroupMessage(botQqUin, groupId, formatPrivateReplyNoTarget(stylishEnabled));
      return;
    }

    const target = this.privateForwardMsgIdMap.get(replyToMsgId);
    if (!target) {
      await this.sendGroupMessage(botQqUin, groupId, formatPrivateReplyNoTarget(stylishEnabled));
      return;
    }
    if (target.botQqUin !== botQqUin) {
      // 不是当前 bot 转发的消息，跳过；对应 bot 也会收到此命令并处理
      return;
    }

    await this.sendPrivateMessage(botQqUin, target.userQqUin, formatPrivateReplyReceived(text, stylishEnabled));
    await this.sendGroupMessage(botQqUin, groupId, formatPrivateReplySent(target.userNickname, target.userQqUin, stylishEnabled));

    // 异步递增管理员回复计数
    prisma.botAccount.update({
      where: { id: bot.id },
      data: { adminRepliesSent: { increment: 1 } },
    }).catch((error) => {
      this.logger.warn({ error, botId: bot.id }, "failed to increment admin reply counter");
    });
  }

  private storePrivateForwardMapping(msgId: string, userQqUin: string, userNickname: string, botQqUin: string) {
    if (this.privateForwardMsgIdMap.size >= OneBotRuntime.MAX_FORWARD_MSG_ID_MAP_SIZE) {
      // 删除最早的一条记录
      const firstKey = this.privateForwardMsgIdMap.keys().next().value;
      if (firstKey !== undefined) {
        this.privateForwardMsgIdMap.delete(firstKey);
      }
    }
    this.privateForwardMsgIdMap.set(msgId, { userQqUin, userNickname, botQqUin });
  }

  private extractMessageId(data: unknown): string | null {
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (d.message_id !== undefined) {
        return String(d.message_id);
      }
    }
    return null;
  }

  private extractReplyMessageId(event: OneBotMessageEvent): string | null {
    if (typeof event.raw_message === "string") {
      const m = event.raw_message.match(/\[CQ:reply,id=(\d+)(?:,.*)?\]/);
      if (m) return m[1] ?? null;
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
    return null;
  }

  private isSkippablePrivateMessage(text: string): boolean {
    return /请求添加(你为)?好友/.test(text);
  }

  /**
   * 检查消息是否仅包含 QQ 表情包（[CQ:image,sub_type=1]）和/或普通表情（[CQ:face]）。
   * 这类消息由 NapCat 在接收 QQ 动画表情/贴图时产生，无需转发或处理。
   */
  private isStickerOnlyMessage(event: OneBotMessageEvent): boolean {
    // 优先从消息段数组判断
    if (Array.isArray(event.message)) {
      const segments = event.message as OneBotMessageSegment[];
      if (segments.length === 0) return false;

      const hasStickerImage = segments.some(
        (seg) => seg.type === "image" && String(seg.data?.sub_type ?? "") === "1",
      );
      if (!hasStickerImage) return false;

      const allStickerOrFaceOrEmpty = segments.every((seg) => {
        if (seg.type === "text") {
          return String(seg.data?.text ?? "").trim().length === 0;
        }
        if (seg.type === "face") return true;
        if (seg.type === "image") {
          return String(seg.data?.sub_type ?? "") === "1";
        }
        return false;
      });

      return allStickerOrFaceOrEmpty;
    }

    // 兜底：从 raw_message 判断（NapCat 某些场景可能只给字符串）
    if (typeof event.raw_message === "string" && event.raw_message) {
      const stickerImageRe = /\[CQ:image,[^\]]*sub_type=1[^\]]*\]/;
      if (!stickerImageRe.test(event.raw_message)) return false;

      // 如果包含普通图片（非 sticker），保留不处理
      const normalImageRe = /\[CQ:image,[^\]]*sub_type=(?!1)\d+[^\]]*\]|\[CQ:image,(?!.*sub_type)[^\]]*\]/;
      if (normalImageRe.test(event.raw_message)) return false;

      // 移除所有 sticker image 和 face 段后，剩下的是纯表情包消息
      const cleaned = event.raw_message
        .replace(stickerImageRe, "")
        .replace(/\[CQ:face,[^\]]*\]/g, "")
        .replace(/\[CQ:text,[^\]]*\]/g, "")
        .trim();

      return cleaned.length === 0;
    }

    return false;
  }

  /**
   * 检查消息是否为 "我是<昵称>" 的自我介绍消息，这类消息无需转发。
   * 匹配时忽略前后空白、标点符号差异。
   */
  private isSelfIntroMessage(text: string, nickname: string): boolean {
    const intro = `我是${nickname}`;
    // 精确匹配：允许前后空白，允许昵称后有标点符号结束
    const pattern = new RegExp(`^我是${escapeRegex(nickname)}[，。！？,.\!?]?$`);
    return text.trim() === intro || pattern.test(text.trim());
  }

  private async loadPostAttachmentSegments(attachments: unknown) {
    if (!this.config || !Array.isArray(attachments)) {
      return [];
    }
    const storage = getStorageDriver(this.config);
    const segments = [];
    for (const attachment of attachments) {
      const candidate = attachment as any;
      if (!candidate.key) {
        continue;
      }
      try {
        const object = await storage.getBytes(candidate.key);
        if (!object) {
          continue;
        }
        const bytes = object.bytes;
        const contentType = object.contentType ?? inferImageContentType(candidate.fileName ?? candidate.key);
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
  return readMentionedQqUins(event).includes(botQqUin);
}

function readMentionedQqUins(event: OneBotMessageEvent) {
  const mentions = new Set<string>();
  if (typeof event.raw_message === "string") {
    for (const match of event.raw_message.matchAll(/\[CQ:at,qq=(\d+)\]/g)) {
      const qqUin = normalizeId(match[1]);
      if (qqUin) {
        mentions.add(qqUin);
      }
    }
  }
  if (Array.isArray(event.message)) {
    for (const segment of event.message) {
      const item = segment as { type?: string; data?: { qq?: string | number } };
      const qqUin = item.type === "at" ? normalizeId(item.data?.qq) : null;
      if (qqUin) {
        mentions.add(qqUin);
      }
    }
  }
  return [...mentions];
}

export function shouldHandleReviewGroupCommandForBot(input: {
  currentBotId: string;
  currentBotQqUin: string;
  mentionedBotQqUins: string[];
  preferredBotId: string | null;
}) {
  const mentioned = input.mentionedBotQqUins;
  if (mentioned.length > 0) {
    return mentioned.includes(input.currentBotQqUin);
  }
  return input.preferredBotId === null || input.preferredBotId === input.currentBotId;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCommandInput(input: string) {
  return input.replace(/\[CQ:at,qq=\d+\]/g, "").trim();
}

export function parseCommand(input: string) {
  const normalized = normalizeCommandInput(input);

  // 同时支持半角 # / 与全角 ＃ 作为命令前缀（全角 # 在中文输入法下很常见，否则会出现指令无法识别）
  const commandStart = normalized.search(/[#＃/]/);
  if (commandStart < 0) {
    return null;
  }
  const prefix = normalized.slice(0, commandStart).trim();
  if (prefix && !prefix.startsWith("@")) {
    return null;
  }
  const commandText = normalized.slice(commandStart);
  const match = commandText.match(/^[#＃/]\s*([^\s]+)\s*(.*)$/);
  const name = match?.[1];
  if (!match || !name) {
    return null;
  }
  return {
    name,
    args: match[2]?.trim() ?? "",
  };
}

export function parseReviewGroupCommand(input: string) {
  const command = parseCommand(input);
  if (command) {
    return command;
  }

  const normalized = normalizeCommandInput(input);
  const bareCommand = normalized.match(/^(ban|unban)\b(?:\s+(.*))?$/i);
  if (!bareCommand?.[1]) {
    return null;
  }
  return {
    name: bareCommand[1].toLowerCase(),
    args: bareCommand[2]?.trim() ?? "",
  };
}

export function shouldNotifyReviewGroupAfterPrivatePostCreate(post: { status: string }) {
  return post.status === "pending_approval";
}

export function shouldSubmitPrivatePostAfterModeSelection(semantic: PrivatePostSemanticResult | undefined) {
  return semantic?.intent === "post" && semantic.anonymous === null;
}

export function isPrivatePostAiIntakeActive(configured: boolean, llmAvailable: boolean) {
  return configured && llmAvailable;
}

export function shouldRunPrivatePostKeywordCommand(aiIntakeEnabled: boolean) {
  return !aiIntakeEnabled;
}

export function resolvePrivatePostSemanticAction(semantic: PrivatePostSemanticResult | undefined) {
  if (!semantic || semantic.confidence < 0.4) {
    return null;
  }
  if (hasPrivatePostCancelSemanticCue(semantic)) {
    return "cancel";
  }
  if (semantic.action !== "none") {
    return semantic.action;
  }
  return null;
}

export function shouldAppendPrivatePostContentForSemantic(semantic: PrivatePostSemanticResult | undefined) {
  if (!semantic) {
    return true;
  }
  if (semantic.intent === "command") {
    return false;
  }
  return semantic.action === "none" || semantic.intent === "post";
}

export function shouldApplyPrivatePostSemanticText(semantic: PrivatePostSemanticResult | undefined) {
  return semantic?.intent === "post" && Boolean(semantic.text);
}

export function shouldConfirmPrivatePostSubmissionFromSemantic(semantic: PrivatePostSemanticResult | undefined) {
  const action = resolvePrivatePostSemanticAction(semantic);
  if (action === "submit" || (semantic?.shouldSubmit === true && semantic.confidence >= 0.4)) {
    return { confirmed: true };
  }
  if (action === "cancel" || hasPrivatePostCancelSemanticCue(semantic)) {
    return { confirmed: false };
  }
  return null;
}

function hasPrivatePostCancelSemanticCue(semantic: PrivatePostSemanticResult | undefined) {
  if (!semantic || semantic.confidence < 0.4 || semantic.shouldSubmit === true) {
    return false;
  }
  const cancelCuePattern = /^(取消|取消投稿|确认取消|确认取消投稿|算了|不投了?|不想投了?|不要投了?|不发了?|放弃|放弃投稿|撤销稿件|撤销投稿|撤回投稿|撤稿)$/;
  const normalizedText = semantic.text.trim().replace(/[\s，。！？!?,.；;：:、]/g, "");
  if (normalizedText && normalizedText.length <= 12 && cancelCuePattern.test(normalizedText)) {
    return true;
  }
  const normalizedReason = semantic.reason.trim().replace(/[\s，。！？!?,.；;：:、]/g, "");
  if (!normalizedReason || /(?:不是|并非|没有|无)(?:要|想|表示)?(?:取消|放弃|撤销|撤回)/.test(normalizedReason)) {
    return false;
  }
  return /(?:用户|明确)?(?:想|要|表示|确认)?(?:取消|放弃|撤销|撤回)(?:当前|本次)?投稿/.test(normalizedReason);
}

export function resolvePrivatePostModeSelectionFromSemantic(semantic: PrivatePostSemanticResult | undefined) {
  if (!semantic || semantic.confidence < 0.4 || semantic.anonymous === null || semantic.anonymous === undefined) {
    return null;
  }
  return { anonymous: semantic.anonymous };
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

export function parseBanCommandArgs(args: string) {
  const match = args.trim().match(/^(\d+)\s+(.+\S)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    qqUin: match[1],
    reason: match[2].trim(),
  };
}

export function parseUnbanCommandArgs(args: string) {
  const match = args.trim().match(/^(\d+)$/);
  if (!match?.[1]) {
    return null;
  }
  return {
    qqUin: match[1],
  };
}

function readPrivateInputStatus(event: OneBotMessageEvent): { typing: boolean } | null {
  const notice = String(event.notice_type ?? "").toLowerCase();
  const subType = String(event.sub_type ?? "").toLowerCase();
  const status = event.status;
  const normalizedStatus = typeof status === "string" ? status.toLowerCase() : typeof status === "number" ? String(status) : "";
  const raw = [notice, subType, normalizedStatus].filter(Boolean).join(" ");
  if (!raw) {
    return null;
  }
  const isInputNotice = raw.includes("input") || raw.includes("typing") || raw.includes("input_status") || raw.includes("inputstatus");
  if (!isInputNotice) {
    return null;
  }
  if (raw.includes("stop") || raw.includes("end") || raw.includes("idle") || raw.includes("false") || raw.includes("0") || raw.includes("off")) {
    return { typing: false };
  }
  if (raw.includes("start") || raw.includes("begin") || raw.includes("typing") || raw.includes("input") || raw.includes("true") || raw.includes("1") || raw.includes("on")) {
    return { typing: true };
  }
  return null;
}

function mergePrivatePostAggregateEvents(events: OneBotMessageEvent[], text: string): OneBotMessageEvent {
  const first = events[0] ?? {};
  const message: unknown[] = text ? [{ type: "text", data: { text } }] : [];
  for (const event of events) {
    const images = extractOneBotImageSegments(event.message);
    message.push(...images);
  }
  const merged: OneBotMessageEvent = {
    ...first,
    message,
  };
  const rawMessage = text || first.raw_message;
  if (rawMessage) {
    merged.raw_message = rawMessage;
  }
  return merged;
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
  return isPrismaKnownRequestError(value) && value.code === "P2034";
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
