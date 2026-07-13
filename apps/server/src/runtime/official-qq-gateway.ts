import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma";
import {
  getOfficialQqAuthorization,
  getOfficialQqGateway,
  sendOfficialQqChannelReply,
  type OfficialQqBotAccount,
} from "./official-qq";

const publicGuildMessagesIntent = 1 << 30;
const reconnectDelayMs = 10_000;

type GatewayPayload = { op?: number; d?: unknown; s?: number; t?: string };
type GatewayMessage = { id?: string | undefined; guild_id?: string | undefined; channel_id?: string | undefined; content?: string | undefined };
type ActiveConnection = {
  socket: WebSocket;
  signature: string;
  stopped: boolean;
  awaitingHeartbeatAck: boolean;
  heartbeat?: ReturnType<typeof setInterval>;
};

export function isOfficialQqIdCommand(content: string) {
  return content.trim().replace(/^<@!?#?\d+>\s*/, "").trim().toLowerCase() === "/id";
}

export function formatOfficialQqIdReply(message: GatewayMessage) {
  return [
    "当前频道信息",
    `guild_id：${message.guild_id ?? "未知"}`,
    `channel_id：${message.channel_id ?? "未知"}`,
    `message_id：${message.id ?? "未知"}`,
  ].join("\n");
}

export class OfficialQqGatewayRuntime {
  private readonly connections = new Map<string, ActiveConnection>();
  private readonly connecting = new Set<string>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private refreshTimer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly logger: FastifyBaseLogger) {}

  async start() {
    await this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), 60_000);
  }

  close() {
    this.closed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const connection of this.connections.values()) this.stopConnection(connection);
    this.connections.clear();
  }

  private async refresh() {
    const candidates = await prisma.botAccount.findMany({
      where: { platform: "official_qq", enabled: true, officialAppId: { not: null } },
      select: { id: true, officialAppId: true, officialAppSecret: true },
    }).catch((error) => {
      this.logger.warn({ error }, "official qq gateway bot refresh failed");
      return [];
    });
    const bots = candidates.filter((bot): bot is typeof bot & { officialAppId: string } => Boolean(bot.officialAppId && bot.officialAppSecret));
    const activeIds = new Set(bots.map((bot) => bot.id));
    for (const [botId, connection] of this.connections) {
      if (!activeIds.has(botId)) {
        this.stopConnection(connection);
        this.connections.delete(botId);
      }
    }
    for (const bot of bots) {
      const signature = botSignature(bot);
      const existing = this.connections.get(bot.id);
      if (existing && existing.signature !== signature) {
        this.stopConnection(existing);
        this.connections.delete(bot.id);
      }
      if (!this.connections.has(bot.id) && !this.connecting.has(bot.id)) void this.connect(bot);
    }
  }

  private async connect(bot: OfficialQqBotAccount) {
    if (this.closed || this.connections.has(bot.id) || this.connecting.has(bot.id)) return;
    this.connecting.add(bot.id);
    try {
      const [url, authorization] = await Promise.all([getOfficialQqGateway(bot), getOfficialQqAuthorization(bot)]);
      if (this.closed || this.connections.has(bot.id)) return;
      const socket = new WebSocket(url);
      const connection: ActiveConnection = {
        socket,
        signature: botSignature(bot),
        stopped: false,
        awaitingHeartbeatAck: false,
      };
      this.connections.set(bot.id, connection);
      let sequence: number | null = null;

      socket.addEventListener("message", (event) => {
        void this.handlePayload(bot, connection, authorization, event.data, (value) => { sequence = value; }, () => sequence);
      });
      socket.addEventListener("open", () => this.logger.info({ botId: bot.id }, "official qq gateway connected"));
      socket.addEventListener("error", (error) => this.logger.warn({ error, botId: bot.id }, "official qq gateway error"));
      socket.addEventListener("close", () => {
        const shouldReconnect = !this.closed && !connection.stopped;
        this.stopConnection(connection);
        if (this.connections.get(bot.id) === connection) this.connections.delete(bot.id);
        if (shouldReconnect) this.scheduleReconnect(bot);
      });
    } catch (error) {
      this.logger.warn({ error, botId: bot.id }, "official qq gateway connect failed");
      if (!this.closed) this.scheduleReconnect(bot);
    } finally {
      this.connecting.delete(bot.id);
    }
  }

  private async handlePayload(
    bot: OfficialQqBotAccount,
    connection: ActiveConnection,
    authorization: string,
    raw: unknown,
    setSequence: (value: number) => void,
    getSequence: () => number | null,
  ) {
    try {
      const payload = JSON.parse(String(raw)) as GatewayPayload;
      if (typeof payload.s === "number") setSequence(payload.s);
      if (payload.op === 11) {
        connection.awaitingHeartbeatAck = false;
        return;
      }
      if (payload.op === 7 || payload.op === 9) {
        connection.socket.close();
        return;
      }
      if (payload.op === 10) {
        const interval = readHeartbeatInterval(payload.d);
        connection.socket.send(JSON.stringify({
          op: 2,
          d: {
            token: authorization,
            intents: publicGuildMessagesIntent,
            shard: [0, 1],
            properties: { $os: "linux", $browser: "campux", $device: "campux" },
          },
        }));
        if (connection.heartbeat) clearInterval(connection.heartbeat);
        connection.heartbeat = setInterval(() => {
          if (connection.socket.readyState === WebSocket.OPEN) {
            if (connection.awaitingHeartbeatAck) {
              this.logger.warn({ botId: bot.id }, "official qq gateway heartbeat ack timeout");
              connection.socket.close();
              return;
            }
            connection.awaitingHeartbeatAck = true;
            connection.socket.send(JSON.stringify({ op: 1, d: getSequence() }));
          }
        }, interval);
        return;
      }
      if (payload.op !== 0 || payload.t !== "AT_MESSAGE_CREATE") return;
      const message = readGatewayMessage(payload.d);
      if (!message?.id || !message.channel_id || !isOfficialQqIdCommand(message.content ?? "")) return;
      await sendOfficialQqChannelReply(bot, message.channel_id, message.id, formatOfficialQqIdReply(message));
    } catch (error) {
      this.logger.warn({ error, botId: bot.id }, "official qq gateway event handling failed");
    }
  }

  private stopConnection(connection: ActiveConnection) {
    connection.stopped = true;
    if (connection.heartbeat) clearInterval(connection.heartbeat);
    connection.socket.close();
  }

  private scheduleReconnect(bot: OfficialQqBotAccount) {
    if (this.closed || this.reconnectTimers.has(bot.id)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(bot.id);
      void this.connect(bot);
    }, reconnectDelayMs);
    this.reconnectTimers.set(bot.id, timer);
  }
}

function botSignature(bot: OfficialQqBotAccount) {
  return `${bot.officialAppId ?? ""}:${JSON.stringify(bot.officialAppSecret)}`;
}

function readHeartbeatInterval(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 45_000;
  const interval = (value as Record<string, unknown>).heartbeat_interval;
  return typeof interval === "number" && interval >= 1_000 ? interval : 45_000;
}

function readGatewayMessage(value: unknown): GatewayMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return {
    id: typeof item.id === "string" ? item.id : undefined,
    guild_id: typeof item.guild_id === "string" ? item.guild_id : undefined,
    channel_id: typeof item.channel_id === "string" ? item.channel_id : undefined,
    content: typeof item.content === "string" ? item.content : undefined,
  };
}
