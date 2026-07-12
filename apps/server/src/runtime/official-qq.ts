import type { Prisma } from "@campux/db";
import { decryptJson } from "../lib/secret-json";
import { BotWorkflowError } from "../lib/bot-workflows";

const qqBotTokenEndpoint = "https://bots.qq.com/app/getAppAccessToken";
const qqBotOpenApiBaseUrl = "https://api.sgroup.qq.com";

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

export type OfficialQqBotAccount = {
  id: string;
  officialAppId: string | null;
  officialAppSecret: Prisma.JsonValue | null;
};

export async function sendOfficialQqChannelMessage(bot: OfficialQqBotAccount, channelId: string, message: unknown) {
  if (!bot.officialAppId || !bot.officialAppSecret) {
    throw new BotWorkflowError("QQ 官方机器人 AppID 或 AppSecret 未配置", 400);
  }
  const content = normalizeOfficialQqMessageContent(message);
  if (!content) {
    throw new BotWorkflowError("QQ 官方机器人消息内容为空", 400);
  }

  const accessToken = await getOfficialQqAccessToken(bot.officialAppId, bot.officialAppSecret);
  const response = await fetch(`${qqBotOpenApiBaseUrl}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new BotWorkflowError(`QQ 官方机器人频道消息发送失败：${response.status} ${responseText}`, 502);
  }
  return responseText ? JSON.parse(responseText) : null;
}

async function getOfficialQqAccessToken(appId: string, secretValue: Prisma.JsonValue) {
  const now = Date.now();
  const cached = tokenCache.get(appId);
  if (cached && cached.expiresAt - now > 60_000) {
    return cached.accessToken;
  }

  const clientSecret = readOfficialQqAppSecret(secretValue);
  const response = await fetch(qqBotTokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ appId, clientSecret }),
  });
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: string | number; message?: string } | null;
  if (!response.ok || !payload?.access_token) {
    throw new BotWorkflowError(`QQ 官方机器人 AccessToken 获取失败：${response.status} ${payload?.message ?? "未知错误"}`, 502);
  }

  const expiresInSeconds = Number(payload.expires_in ?? 7200);
  tokenCache.set(appId, {
    accessToken: payload.access_token,
    expiresAt: now + Math.max(60, expiresInSeconds) * 1000,
  });
  return payload.access_token;
}

function readOfficialQqAppSecret(value: Prisma.JsonValue) {
  const decrypted = decryptJson(value);
  if (typeof decrypted === "string" && decrypted.trim()) {
    return decrypted.trim();
  }
  if (decrypted && typeof decrypted === "object" && !Array.isArray(decrypted)) {
    const secret = (decrypted as Record<string, unknown>).appSecret;
    if (typeof secret === "string" && secret.trim()) {
      return secret.trim();
    }
  }
  throw new BotWorkflowError("QQ 官方机器人 AppSecret 无法解析", 500);
}

export function normalizeOfficialQqMessageContent(message: unknown): string {
  if (typeof message === "string") return message.trim();
  if (Array.isArray(message)) {
    return message.map((segment) => {
      if (typeof segment === "string") return segment;
      if (segment && typeof segment === "object") {
        const record = segment as Record<string, unknown>;
        if (record.type === "text" && record.data && typeof record.data === "object") {
          const text = (record.data as Record<string, unknown>).text;
          return typeof text === "string" ? text : "";
        }
        if (record.type === "at" && record.data && typeof record.data === "object") {
          const qq = (record.data as Record<string, unknown>).qq;
          return qq === "all" ? "@全体成员" : `@${String(qq ?? "")}`;
        }
      }
      return "";
    }).join("").trim();
  }
  return String(message ?? "").trim();
}
