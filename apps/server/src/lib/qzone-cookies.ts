import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma";
import { isQZoneProtocolAutoRefreshCooldownError, isQZoneProtocolAutoRefreshTransientError } from "./qzone-auto-refresh";
import { decryptJson } from "./secret-json";
import { parseQZoneVisitorCounts, qzoneVisitorSnapshotDate } from "./qzone-visitor-stats";
import { tenantRuntimeRelationFilter } from "./tenant-runtime";
import { runWithActiveTenantLease } from "./tenant-runtime-lease";

type QZoneCookieNotifier = {
  notifyQZoneCookiesInvalid(botAccountId: string, message: string, options?: { autoRefreshError?: string | null }): Promise<void>;
  refreshQZoneCookiesByProtocol?(botAccountId: string, reason: "heartbeat_invalid"): Promise<{ cookieNames: string[] }>;
  resumeWaitingPublishAttemptsForBot?(botAccountId: string): Promise<number>;
};

export const qzoneCookieHealthStatuses = ["unchecked", "available", "invalid"] as const;
export type QZoneCookieHealthStatus = (typeof qzoneCookieHealthStatuses)[number];

/**
 * 单次登录态检测的结果：
 * - available / invalid：拿到了确定结论；
 * - transient：检测本身失败（网络抖动、超时、网关非 200、响应不可解析），
 *   不能证明登录态失效。此时不应改动 session 的 healthStatus，也不计入连续失败，
 *   否则 QZone 对检测端点限流时会把可用的 cookies 误判为失效，
 *   连锁触发虚假的 bot 异常告警和发布任务无限等待（网站一直“发布中”）。
 */
export type QZoneCookieHealthCheckResult = {
  status: "available" | "invalid" | "transient";
  message: string;
  visitorCounts?: {
    todayCount: number;
    totalCount: number;
  };
};

const visitorAmountUrl =
  "https://h5.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_more?uin={uin}&mask=7&g_tk={gtk}&page=1&fupdate=1&clear=1";
const invalidCookieNotifyCooldownMs = 30 * 60 * 1000;
const invalidCookieNotifyFailureThreshold = 3;

export async function checkQZoneCookieHealth(cookies: Record<string, string>, fallbackUin: string): Promise<QZoneCookieHealthCheckResult> {
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
      // HTTP 层异常（网关/WAF/限流）不代表登录态失效，视为检测暂时不可用。
      return {
        status: "transient",
        message: `登录态检测暂时不可用：QZone 检测接口 HTTP ${response.status}`,
      };
    }

    const payload = parseQZoneCallbackJson(text);
    if (!payload) {
      // 响应体无法解析（可能是限流页/风控页），同样不作为登录态失效的依据。
      return {
        status: "transient",
        message: "登录态检测暂时不可用：QZone 检测接口没有返回可解析的数据",
      };
    }
    const data = payload?.data;
    const visitorCounts = parseQZoneVisitorCounts(data);
    if (visitorCounts) {
      return {
        status: "available" as const,
        message: `可用，今日访客 ${visitorCounts.todayCount}，总访客 ${visitorCounts.totalCount}`,
        visitorCounts,
      };
    }

    const message = typeof payload?.message === "string" ? payload.message : typeof payload?.msg === "string" ? payload.msg : "";
    const code = typeof payload?.code === "number" ? payload.code : null;
    if (code !== null && code !== 0 && !isQZoneLoginFailureMessage(message)) {
      // QZone 返回了可解析的业务错误负载（限流/风控等）：不能证明登录态失效，按检测暂时不可用处理。
      // 只有 message 命中登录失效特征（实测如 code: -87998, "login error"）才判定失效。
      return {
        status: "transient",
        message: `登录态检测暂时不可用：QZone 返回业务错误码 ${code}${message ? `（${message}）` : ""}`,
      };
    }
    return {
      status: "invalid" as const,
      message: message || "QZone 没有返回有效访客数据",
    };
  } catch (caught) {
    // 超时/网络异常属于检测本身的失败，不能据此判定登录态失效。
    return {
      status: "transient",
      message: `登录态检测暂时不可用：${caught instanceof Error ? caught.message : "QZone cookies 检测失败"}`,
    };
  }
}

export async function checkAndUpdateQZoneSession(sessionId: string) {
  const session = await prisma.botSession.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      botAccount: { include: { tenant: { select: { status: true } } } },
    },
  });
  if (!session || session.botAccount.tenant.status !== "active") {
    return null;
  }

  const cookies = toCookieRecord(decryptJson(session.cookies));
  const leased = await runWithActiveTenantLease(prisma, session.botAccount.tenantId, async (transaction) => {
    const result = await checkQZoneCookieHealth(cookies, session.botAccount.qqUin.toString());
    // 检测期间会话可能被协议刷新并发替换：只对“仍是同一套 cookies”的会话应用结果，
    // 否则针对旧 cookies 的迟到结论会把刷新后的新会话误标为失效（阻塞发布/再触发刷新/误告警）。
    const current = await transaction.botSession.findUnique({
      where: {
        id: session.id,
      },
      select: {
        cookies: true,
        healthStatus: true,
      },
    });
    if (!current || JSON.stringify(current.cookies) !== JSON.stringify(session.cookies)) {
      return null;
    }
    // transient（检测接口抖动）只记录检测时间和消息，不改写 healthStatus、不累计失败次数：
    // 上一次的“可用/失效”结论仍然有效，避免限流窗口里把可用 cookies 误标为失效。
    // 例外：历史上被误标为 invalid 的会话在检测持续 transient 时降回 unchecked，
    // 让发布尝试直接验证 cookies（发布结果本身就是更可靠的检测），避免旧结论把发布永久卡死。
    const updated = await transaction.botSession.update({
    where: {
      id: session.id,
    },
    data: {
      ...(result.status === "transient"
        ? current.healthStatus === "invalid"
          ? { healthStatus: "unchecked" }
          : {}
        : { healthStatus: result.status }),
      healthCheckedAt: new Date(),
      healthMessage: result.message,
      ...(result.status === "invalid" ? { healthFailureCount: { increment: 1 } } : {}),
      ...(result.status === "available" ? { healthFailureCount: 0, healthInvalidNotifiedAt: null } : {}),
    },
  });

    if (result.status === "available" && result.visitorCounts) {
      await transaction.qZoneVisitorSnapshot.upsert({
      where: {
        botAccountId_date: {
          botAccountId: session.botAccountId,
          date: qzoneVisitorSnapshotDate(updated.healthCheckedAt ?? new Date()),
        },
      },
      create: {
        tenantId: session.botAccount.tenantId,
        botAccountId: session.botAccountId,
        sessionId: session.id,
        date: qzoneVisitorSnapshotDate(updated.healthCheckedAt ?? new Date()),
        todayCount: result.visitorCounts.todayCount,
        totalCount: result.visitorCounts.totalCount,
        checkedAt: updated.healthCheckedAt ?? new Date(),
      },
      update: {
        sessionId: session.id,
        todayCount: result.visitorCounts.todayCount,
        totalCount: result.visitorCounts.totalCount,
        checkedAt: updated.healthCheckedAt ?? new Date(),
      },
      });
    }
    return updated;
  });
  return leased.active ? leased.value : null;
}

export function registerQZoneCookieHeartbeat(logger: FastifyBaseLogger, notifier?: QZoneCookieNotifier) {
  async function run() {
    const sessions = await prisma.botSession.findMany({
      where: {
        type: "qzone",
        botAccount: {
          enabled: true,
          tenant: tenantRuntimeRelationFilter,
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
              if (isQZoneProtocolAutoRefreshCooldownError(error)) {
                logger.debug(
                  { sessionId: session.id, botAccountId: session.botAccountId, remainingMs: error.remainingMs },
                  "qzone cookies protocol auto refresh skipped during cooldown after heartbeat invalid",
                );
                continue;
              }
              if (isQZoneProtocolAutoRefreshTransientError(error)) {
                // OneBot 连接瞬时不可用：不发失效通知、不标记已通知，等下一次心跳重试刷新
                logger.warn({ sessionId: session.id, botAccountId: session.botAccountId, error: toErrorMessage(error) }, "qzone cookies protocol auto refresh skipped after heartbeat invalid: onebot connection transiently unavailable");
                continue;
              }
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
    return JSON.parse(jsonText) as { code?: unknown; data?: unknown; message?: unknown; msg?: unknown };
  } catch {
    return null;
  }
}

/** QZone 明确的登录态失效错误特征（实测如 code: -87998, message: "login error"）。 */
function isQZoneLoginFailureMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("login error") ||
    normalized.includes("not login") ||
    message.includes("未登录") ||
    message.includes("重新登录") ||
    message.includes("请登录")
  );
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
