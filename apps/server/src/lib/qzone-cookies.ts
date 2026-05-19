import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma";
import { decryptJson } from "./secret-json";

type QZoneCookieNotifier = {
  notifyQZoneCookiesInvalid(botAccountId: string, message: string, options?: { autoRefreshError?: string | null }): Promise<void>;
  refreshQZoneCookiesByProtocol?(botAccountId: string, reason: "heartbeat_invalid"): Promise<{ cookieNames: string[] }>;
  resumeWaitingPublishAttemptsForBot?(botAccountId: string): Promise<number>;
};

export const qzoneCookieHealthStatuses = ["unchecked", "available", "invalid"] as const;
export type QZoneCookieHealthStatus = (typeof qzoneCookieHealthStatuses)[number];

const visitorAmountUrl =
  "https://h5.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_more?uin={uin}&mask=7&g_tk={gtk}&page=1&fupdate=1&clear=1";
const invalidCookieNotifyCooldownMs = 30 * 60 * 1000;
const invalidCookieNotifyFailureThreshold = 3;

export async function checkQZoneCookieHealth(cookies: Record<string, string>, fallbackUin: string) {
  const pSkey = cookies.p_skey;
  const uin = normalizeQqUin(cookies.uin ?? fallbackUin);
  if (!pSkey) {
    return {
      status: "invalid" as const,
      message: "cookies 缺少 p_skey，无法验证 QZone 登录态",
    };
  }
  if (!uin) {
    return {
      status: "invalid" as const,
      message: "cookies 缺少 uin，无法验证 QZone 登录态",
    };
  }

  try {
    const response = await fetch(visitorAmountUrl.replace("{uin}", uin).replace("{gtk}", generateGtk(pSkey)), {
      headers: {
        Cookie: Object.entries(cookies)
          .map(([name, value]) => `${name}=${value}`)
          .join("; "),
        Referer: `https://user.qzone.qq.com/${uin}`,
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        status: "invalid" as const,
        message: `QZone 检测失败：HTTP ${response.status}`,
      };
    }

    const payload = parseQZoneCallbackJson(text);
    const data = payload?.data;
    if (data && typeof data === "object" && "todaycount" in data && "totalcount" in data) {
      return {
        status: "available" as const,
        message: `可用，今日访客 ${String((data as { todaycount: unknown }).todaycount)}，总访客 ${String((data as { totalcount: unknown }).totalcount)}`,
      };
    }

    const message = typeof payload?.message === "string" ? payload.message : typeof payload?.msg === "string" ? payload.msg : "QZone 没有返回有效访客数据";
    return {
      status: "invalid" as const,
      message,
    };
  } catch (caught) {
    return {
      status: "invalid" as const,
      message: caught instanceof Error ? caught.message : "QZone cookies 检测失败",
    };
  }
}

export async function checkAndUpdateQZoneSession(sessionId: string) {
  const session = await prisma.botSession.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      botAccount: true,
    },
  });
  if (!session) {
    return null;
  }

  const cookies = toCookieRecord(decryptJson(session.cookies));
  const result = await checkQZoneCookieHealth(cookies, session.botAccount.qqUin.toString());
  return prisma.botSession.update({
    where: {
      id: session.id,
    },
    data: {
      healthStatus: result.status,
      healthCheckedAt: new Date(),
      healthMessage: result.message,
      healthFailureCount: result.status === "invalid" ? { increment: 1 } : 0,
      ...(result.status === "available" ? { healthInvalidNotifiedAt: null } : {}),
    },
  });
}

export function registerQZoneCookieHeartbeat(logger: FastifyBaseLogger, notifier?: QZoneCookieNotifier) {
  async function run() {
    const sessions = await prisma.botSession.findMany({
      where: {
        type: "qzone",
        botAccount: {
          enabled: true,
        },
      },
      select: {
        id: true,
        healthStatus: true,
        healthFailureCount: true,
        healthInvalidNotifiedAt: true,
        botAccountId: true,
        botAccount: {
          select: {
            publishTargets: {
              where: {
                enabled: true,
                qzoneRefreshMode: "protocol",
              },
              select: {
                id: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    for (const session of sessions) {
      try {
        const updated = await checkAndUpdateQZoneSession(session.id);
        if (updated?.healthStatus === "available") {
          await notifier?.resumeWaitingPublishAttemptsForBot?.(session.botAccountId).catch((error) => {
            logger.warn({ error, sessionId: session.id, botAccountId: session.botAccountId }, "failed to resume waiting publish attempts after qzone heartbeat");
          });
        }
        if (updated?.healthStatus === "invalid" && shouldNotifyInvalidCookies(updated)) {
          if (session.botAccount.publishTargets.length > 0 && notifier?.refreshQZoneCookiesByProtocol) {
            try {
              const result = await notifier.refreshQZoneCookiesByProtocol(session.botAccountId, "heartbeat_invalid");
              logger.info({ sessionId: session.id, botAccountId: session.botAccountId, cookieCount: result.cookieNames.length }, "qzone cookies auto refreshed after heartbeat invalid");
              continue;
            } catch (error) {
              logger.warn({ error, sessionId: session.id, botAccountId: session.botAccountId }, "qzone cookies protocol auto refresh failed after heartbeat invalid");
              await markInvalidCookiesNotified(session.id);
              await notifier.notifyQZoneCookiesInvalid(session.botAccountId, updated.healthMessage ?? "QZone cookies 检测失败", {
                autoRefreshError: toErrorMessage(error),
              }).catch((notifyError) => {
                logger.warn({ error: notifyError, sessionId: session.id }, "failed to notify qzone cookies invalid");
              });
              continue;
            }
          }
          await prisma.botSession.update({
            where: {
              id: session.id,
            },
            data: {
              healthInvalidNotifiedAt: new Date(),
            },
          });
          await notifier?.notifyQZoneCookiesInvalid(session.botAccountId, updated.healthMessage ?? "QZone cookies 检测失败").catch((error) => {
            logger.warn({ error, sessionId: session.id }, "failed to notify qzone cookies invalid");
          });
        }
      } catch (error) {
        logger.warn({ error, sessionId: session.id }, "qzone cookie heartbeat failed");
      }
    }
  }

  const timer = setInterval(() => {
    void run().catch((error) => logger.warn({ error }, "qzone cookie heartbeat failed"));
  }, 60_000);
  void run().catch((error) => logger.warn({ error }, "qzone cookie heartbeat failed"));
  return () => clearInterval(timer);
}

function shouldNotifyInvalidCookies(session: { healthFailureCount: number; healthInvalidNotifiedAt: Date | null }) {
  if (session.healthFailureCount < invalidCookieNotifyFailureThreshold) {
    return false;
  }

  const lastNotifiedAt = session.healthInvalidNotifiedAt?.getTime();
  return !lastNotifiedAt || Date.now() - lastNotifiedAt >= invalidCookieNotifyCooldownMs;
}

async function markInvalidCookiesNotified(sessionId: string) {
  await prisma.botSession.update({
    where: {
      id: sessionId,
    },
    data: {
      healthInvalidNotifiedAt: new Date(),
    },
  });
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "协议自动刷新失败";
}

export function generateGtk(skey: string) {
  let value = 5381;
  for (let index = 0; index < skey.length; index += 1) {
    value += (value << 5) + skey.charCodeAt(index);
  }
  return String(value & 2147483647);
}

function parseQZoneCallbackJson(text: string) {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("_Callback(") ? trimmed.replace(/^_Callback\(/, "").replace(/\);?$/, "") : trimmed;
  try {
    return JSON.parse(jsonText) as { data?: unknown; message?: unknown; msg?: unknown };
  } catch {
    return null;
  }
}

function normalizeQqUin(value: string) {
  const matched = value.match(/\d+/);
  return matched ? matched[0] : "";
}

function toCookieRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, cookieValue]) => (typeof cookieValue === "string" ? [[name, cookieValue]] : [])),
  );
}
