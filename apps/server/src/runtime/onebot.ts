import { Buffer } from "node:buffer";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { createS3Client } from "@campux/integrations";
import {
  assertReviewGroup,
  BotWorkflowError,
  findEnabledBot,
  qzoneCookieDomain,
  refreshQZoneCookiesViaBot,
  registerUserViaBot,
  requireBotTenantRole,
  reviewPostViaBot,
  resetPasswordViaBot,
} from "../lib/bot-workflows";
import { prisma } from "../lib/prisma";
import type { RuntimeQueue } from "./queue";
import { pollQZoneQrLogin, startQZoneQrLogin } from "../lib/qzone-login";

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

type ImagePayload = {
  key?: string;
  fileName?: string;
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
  "发送 #注册账号 可以用当前 QQ 注册本校园墙账号。",
  "发送 #重置密码 可以重置你的登录密码。",
].join("\n");

const reviewHelp = [
  "审核命令：",
  "#通过 <稿件id>",
  "#拒绝 <理由> <稿件id>",
  "#重发 <稿件id>",
  "#登录 或 #刷新qzone cookies",
  "#扫码登录",
].join("\n");

export class OneBotRuntime {
  private readonly connections = new Set<OneBotConnection>();
  private readonly pendingActions = new Map<string, PendingAction>();
  private readonly privateAutoReplyAt = new Map<string, number>();

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

    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId: post.tenantId,
        enabled: true,
        reviewGroupId: {
          not: null,
        },
      },
    });

    const images = Array.isArray(post.images) ? post.images : [];
    const imageCount = images.length;
    const lines = [
      `${post.tenant.name} 新稿件`,
      `编号：#${post.displayId}`,
      `投稿人：${post.anonymous ? `匿名（QQ ${post.author.qqUin.toString()}）` : `${post.author.displayName ?? "未命名"}（QQ ${post.author.qqUin.toString()}）`}`,
      `图片：${imageCount} 张`,
      "",
      post.text,
      "",
      `通过：#通过 ${post.displayId}`,
      `拒绝：#拒绝 <理由> ${post.displayId}`,
    ];
    const imageSegments = await this.loadPostImageSegments(post.images);
    const message =
      imageSegments.length > 0
        ? [
            {
              type: "text",
              data: {
                text: lines.join("\n"),
              },
            },
            ...imageSegments,
          ]
        : lines.join("\n");

    for (const bot of bots) {
      if (!bot.reviewGroupId) {
        continue;
      }
      await this.sendGroupMessage(bot.qqUin.toString(), bot.reviewGroupId, message).catch((error) => {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify review group");
      });
    }
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
    await this.broadcastReviewGroup(post.tenantId, `稿件已取消：#${post.displayId}`);
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
    });
    if (!post) {
      return;
    }
    await this.broadcastReviewGroup(post.tenantId, `已成功发表：#${post.displayId}${target ? `\n目标：${target.displayName}` : ""}\n外部 ID：${externalId}`);
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
    await this.broadcastReviewGroup(post.tenantId, lines.join("\n"));
  }

  async notifyQZoneCookiesInvalid(botAccountId: string, message: string) {
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
        "QQ空间cookies已失效，请 @ 并发送 #登录 或 #扫码登录 命令进行重新登录。",
        `墙号：${bot.displayName} / QQ ${bot.qqUin.toString()}`,
        `检测结果：${message}`,
      ].join("\n"),
    ).catch((error) => {
      this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify qzone cookies invalid");
    });
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

  async broadcastReviewGroup(tenantId: string, message: unknown) {
    const bots = await prisma.botAccount.findMany({
      where: {
        tenantId,
        enabled: true,
        reviewGroupId: {
          not: null,
        },
      },
    });
    for (const bot of bots) {
      if (!bot.reviewGroupId) {
        continue;
      }
      await this.sendGroupMessage(bot.qqUin.toString(), bot.reviewGroupId, message).catch((error) => {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to broadcast review group message");
      });
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

    const command = parsePrivateCommand(extractPlainText(event));
    if (!command) {
      const bot = await findEnabledBot(botQqUin);
      if (this.shouldSendPrivateAutoReply(bot.id, userQqUin, bot.userMessageReplyCooldownSeconds)) {
        await this.sendPrivateMessage(botQqUin, userQqUin, bot.userMessageReply || privateHelp).catch(() => undefined);
      }
      return;
    }

    try {
      if (command.name === "注册账号") {
        const result = await registerUserViaBot({
          botQqUin,
          userQqUin,
          displayName: event.sender?.card || event.sender?.nickname || null,
        });
        const message = result.password
          ? `注册成功，初始密码：\n${result.password}`
          : result.alreadyHadTenantAccess
            ? "账号已经注册过了。如果忘记密码，请发送 #重置密码。"
            : "已为你开通本校园墙访问权限，登录密码沿用原账号。忘记密码请发送 #重置密码。";
        await this.sendPrivateMessage(botQqUin, userQqUin, message);
        return;
      }
      if (command.name === "重置密码") {
        const result = await resetPasswordViaBot({
          botQqUin,
          userQqUin,
        });
        await this.sendPrivateMessage(botQqUin, userQqUin, `重置成功，新密码：\n${result.password}`);
        return;
      }

      const bot = await findEnabledBot(botQqUin);
      await this.sendPrivateMessage(botQqUin, userQqUin, bot.userMessageReply || privateHelp);
    } catch (error) {
      await this.sendPrivateMessage(botQqUin, userQqUin, toErrorMessage(error)).catch(() => undefined);
    }
  }

  private async handleGroupMessage(event: OneBotMessageEvent) {
    const botQqUin = normalizeId(event.self_id);
    const groupId = normalizeId(event.group_id);
    const operatorQqUin = normalizeId(event.user_id);
    if (!botQqUin || !groupId || !operatorQqUin || botQqUin === operatorQqUin) {
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
        await this.sendGroupMessage(botQqUin, groupId, `QZone cookies 已刷新（${result.cookieNames.length} 项）。`);
        return;
      }

      if (["扫码登录", "二维码登录", "qzone扫码登录"].includes(command.name)) {
        const bot = await findEnabledBot(botQqUin);
        assertReviewGroup(bot, groupId);
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
        const bot = await findEnabledBot(botQqUin);
        assertReviewGroup(bot, groupId);
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

  private async loadPostImageSegments(images: unknown) {
    if (!this.config || !Array.isArray(images)) {
      return [];
    }
    const s3 = createS3Client(this.config);
    const segments = [];
    for (const image of images) {
      const candidate = image as ImagePayload;
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
        this.logger.warn({ error, imageKey: candidate.key }, "failed to load post image for onebot notification");
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
