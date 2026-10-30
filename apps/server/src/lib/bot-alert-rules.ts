/**
 * Bot 掉线通知的判定规则（纯函数，便于单测）。
 *
 * 与登录态失效通知的区别：
 * - 登录态失效是「不会自愈」的故障，命中即可发信；
 * - 连接断开是「可能自愈」的状态，NapCat 重连窗口通常在秒级，
 *   所以必须等一段宽限期、确认没有新连接后才发，且同一 bot 有冷却时间，
 *   否则每次网络抖动都会发一封邮件。
 */

/** 断开后等这么久仍无连接才发信，覆盖 NapCat 常规重连间隔。 */
export const BOT_OFFLINE_ALERT_GRACE_MS = 60_000;

/** 同一 bot 两次掉线通知的最小间隔，防止反复抖动刷屏。 */
export const BOT_OFFLINE_ALERT_COOLDOWN_MS = 30 * 60_000;

/** 通知规则：登录态失效（不可自愈）与连接断开（可能自愈）。 */
export type BotAlertRule = "login" | "disconnect";

export type BotOfflineAlertGate = {
  /** 插件总开关 */
  pluginEnabled: boolean;
  /** 插件里的「连接断开也通知」 */
  notifyOnDisconnect: boolean;
  /** 是否配置了收件邮箱 */
  hasRecipients: boolean;
  /** 宽限期结束时该 bot 是否已有新连接（重连成功就别报） */
  stillConnected: boolean;
  /** 当前时间戳（ms） */
  now: number;
  /** 上一次掉线通知时间戳（ms），null 表示本进程内还没发过 */
  lastAlertAt: number | null;
};

export function shouldSendBotOfflineAlert(gate: BotOfflineAlertGate): boolean {
  if (!gate.pluginEnabled || !gate.notifyOnDisconnect || !gate.hasRecipients) {
    return false;
  }
  if (gate.stillConnected) {
    return false;
  }
  if (gate.lastAlertAt === null) {
    return true;
  }
  return gate.now - gate.lastAlertAt >= BOT_OFFLINE_ALERT_COOLDOWN_MS;
}

/**
 * 发信前最后一刻的复核：状态在「宽限期到期」到「真正发出邮件」之间还会变。
 * 返回 true 表示本次通知已失效，应放弃发送（不占冷却）。
 */
export function shouldCancelBotOfflineAlert(input: {
  /** 进程是否正在关停 */
  closing: boolean;
  /** 该 bot 当前活跃连接数 */
  activeConnections: number;
  /** 该 bot 当前记录的离线起点（重连会清空） */
  currentOfflineSince: number | undefined;
  /** 本次派发对应的离线起点 */
  expectedOfflineSince: number;
}): boolean {
  if (input.closing) {
    return true;
  }
  if (input.currentOfflineSince !== input.expectedOfflineSince) {
    // 期间发生了重连（清空）或重连后再次断开（换了新起点）：本轮计时作废。
    return true;
  }
  return input.activeConnections > 0;
}

/** 把离线时长写成人话：「1 分 05 秒」「2 小时 03 分」。 */
export function formatBotOfflineDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  }
  return `${seconds} 秒`;
}
