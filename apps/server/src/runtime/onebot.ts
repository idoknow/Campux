import type { FastifyBaseLogger } from "fastify";
import {
  BotWorkflowError,
  findEnabledBot,
  qzoneCookieDomain,
  refreshQZoneCookiesViaBot,
  registerUserViaBot,
  reviewPostViaBot,
  resetPasswordViaBot,
} from "../lib/bot-workflows";
import { prisma } from "../lib/prisma";
import type { RuntimeQueue } from "./queue";

type OneBotConnection = {
  socket: WebSocketLike;
  selfId: string | null;
};

type WebSocketLike = {
  readyState: number;
  send(data: string, callback?: (error?: Error) => void): void;
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
  "#登录 或 #刷新qzone cookies",
].join("\n");

export class OneBotRuntime {
  private readonly connections = new Set<OneBotConnection>();
  private readonly pendingActions = new Map<string, PendingAction>();

  constructor(
    private readonly queue: RuntimeQueue,
    private readonly logger: FastifyBaseLogger,
  ) {}

  handleConnection(socket: WebSocketLike, request: { headers: Record<string, string | string[] | undefined>; url?: string }) {
    const selfId = this.getSelfIdFromRequest(request);
    const connection: OneBotConnection = {
      socket,
      selfId,
    };
    this.connections.add(connection);
    if (selfId) {
      this.markBotSeen(selfId).catch((error) => this.logger.warn({ error, selfId }, "failed to mark onebot bot seen"));
    }

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

    this.logger.info({ selfId }, "onebot websocket connected");
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

    const imageCount = Array.isArray(post.images) ? post.images.length : 0;
    const lines = [
      `${post.tenant.name} 新稿件 #${post.displayId}`,
      `投稿人：${post.anonymous ? "匿名" : `${post.author.displayName ?? "未命名"}（${post.author.qqUin.toString()}）`}`,
      `图片：${imageCount} 张`,
      "",
      post.text,
      "",
      `通过：#通过 ${post.displayId}`,
      `拒绝：#拒绝 <理由> ${post.displayId}`,
    ];

    for (const bot of bots) {
      if (!bot.reviewGroupId) {
        continue;
      }
      await this.sendGroupMessage(bot.qqUin.toString(), bot.reviewGroupId, lines.join("\n")).catch((error) => {
        this.logger.warn({ error, botQqUin: bot.qqUin.toString(), groupId: bot.reviewGroupId }, "failed to notify review group");
      });
    }
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

  async sendGroupMessage(botQqUin: string, groupId: string | bigint, message: string) {
    await this.callAction(botQqUin, "send_group_msg", {
      group_id: Number(groupId),
      message,
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
      connection.selfId = selfId;
      await this.markBotSeen(selfId);
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

    const command = parseCommand(extractPlainText(event));
    if (!command) {
      await this.sendPrivateMessage(botQqUin, userQqUin, privateHelp).catch(() => undefined);
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

      await this.sendPrivateMessage(botQqUin, userQqUin, privateHelp);
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
        await this.sendPrivateMessage(botQqUin, result.post.author.qqUin, `您的稿件 #${displayId} 已通过审核`).catch(() => undefined);
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
        await this.sendPrivateMessage(
          botQqUin,
          result.post.author.qqUin,
          `您的稿件 #${parsed.displayId} 未通过审核，原因：${parsed.comment}`,
        ).catch(() => undefined);
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

      await this.sendGroupMessage(botQqUin, groupId, reviewHelp);
    } catch (error) {
      await this.sendGroupMessage(botQqUin, groupId, toErrorMessage(error)).catch(() => undefined);
    }
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

  private getSelfIdFromRequest(request: { headers: Record<string, string | string[] | undefined>; url?: string }) {
    const header = request.headers["x-self-id"];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    if (header) {
      return header;
    }
    const url = request.url ? new URL(request.url, "http://localhost") : null;
    return url?.searchParams.get("self_id") ?? null;
  }

  private async markBotSeen(selfId: string) {
    await findEnabledBot(selfId);
    await prisma.botAccount.updateMany({
      where: {
        qqUin: BigInt(selfId),
        enabled: true,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }
}

function extractPlainText(event: OneBotMessageEvent) {
  if (typeof event.raw_message === "string") {
    return event.raw_message;
  }
  if (typeof event.message === "string") {
    return event.message;
  }
  if (Array.isArray(event.message)) {
    return event.message
      .map((segment) => {
        const item = segment as { type?: string; data?: { text?: string } };
        return item.type === "text" ? (item.data?.text ?? "") : "";
      })
      .join("");
  }
  return "";
}

function parseCommand(input: string) {
  const normalized = input.replace(/\[CQ:at,qq=\d+\]/g, "").trim();
  const match = normalized.match(/^[#/]\s*([^\s]+)\s*(.*)$/);
  const name = match?.[1];
  if (!match || !name) {
    return null;
  }
  return {
    name,
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
