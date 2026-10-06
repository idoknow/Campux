export const qzoneProtocolAutoRefreshFailureCooldownMs = 2 * 60 * 60 * 1000;

export class QZoneProtocolAutoRefreshCooldownError extends Error {
  readonly remainingMs: number;
  readonly lastError: string | null;

  constructor(remainingMs: number, lastError: string | null) {
    super(`QZone cookies 协议自动刷新冷却中，${formatQZoneAutoRefreshCooldown(remainingMs)}后再试${lastError ? `。上次失败：${lastError}` : ""}`);
    this.name = "QZoneProtocolAutoRefreshCooldownError";
    this.remainingMs = remainingMs;
    this.lastError = lastError;
  }
}

export function isQZoneProtocolAutoRefreshCooldownError(error: unknown): error is QZoneProtocolAutoRefreshCooldownError {
  return error instanceof QZoneProtocolAutoRefreshCooldownError;
}

/**
 * 协议自动刷新的“暂时无法执行”错误：例如触发刷新时 OneBot 连接恰好短暂不在线
 * （NapCat 重连窗口）或动作响应超时。这不代表登录态真的失效，也不代表刷新能力损坏，
 * 因此调用方不应发告警邮件/群失效通知，也不应进入失败冷却，等下一次触发重试即可。
 */
export class QZoneProtocolAutoRefreshTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QZoneProtocolAutoRefreshTransientError";
  }
}

export function isQZoneProtocolAutoRefreshTransientError(error: unknown): error is QZoneProtocolAutoRefreshTransientError {
  if (error instanceof QZoneProtocolAutoRefreshTransientError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("OneBot 连接不在线") || message.includes("等待响应超时");
}

export function formatQZoneAutoRefreshCooldown(remainingMs: number) {
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (remainingMinutes < 60) {
    return `约 ${remainingMinutes} 分钟`;
  }
  const remainingHours = Math.ceil(remainingMinutes / 60);
  return `约 ${remainingHours} 小时`;
}
