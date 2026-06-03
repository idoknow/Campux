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

export function formatQZoneAutoRefreshCooldown(remainingMs: number) {
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  if (remainingMinutes < 60) {
    return `约 ${remainingMinutes} 分钟`;
  }
  const remainingHours = Math.ceil(remainingMinutes / 60);
  return `约 ${remainingHours} 小时`;
}
