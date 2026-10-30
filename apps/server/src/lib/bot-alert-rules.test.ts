import { describe, expect, test } from "bun:test";
import {
  BOT_OFFLINE_ALERT_COOLDOWN_MS,
  formatBotOfflineDuration,
  shouldCancelBotOfflineAlert,
  shouldSendBotOfflineAlert,
} from "./bot-alert-rules";

const baseGate = {
  pluginEnabled: true,
  notifyOnDisconnect: true,
  hasRecipients: true,
  stillConnected: false,
  now: 1_000_000,
  lastAlertAt: null as number | null,
};

describe("shouldSendBotOfflineAlert", () => {
  test("配置齐全且首次离线时发送", () => {
    expect(shouldSendBotOfflineAlert(baseGate)).toBe(true);
  });

  test("插件未启用时不发", () => {
    expect(shouldSendBotOfflineAlert({ ...baseGate, pluginEnabled: false })).toBe(false);
  });

  test("墙关闭「连接断开时也通知」时不发", () => {
    expect(shouldSendBotOfflineAlert({ ...baseGate, notifyOnDisconnect: false })).toBe(false);
  });

  test("没有收件邮箱时不发", () => {
    expect(shouldSendBotOfflineAlert({ ...baseGate, hasRecipients: false })).toBe(false);
  });

  test("宽限期内已经重连成功时不发", () => {
    expect(shouldSendBotOfflineAlert({ ...baseGate, stillConnected: true })).toBe(false);
  });

  test("冷却期内不重复发", () => {
    const gate = {
      ...baseGate,
      lastAlertAt: baseGate.now - BOT_OFFLINE_ALERT_COOLDOWN_MS + 1,
    };
    expect(shouldSendBotOfflineAlert(gate)).toBe(false);
  });

  test("冷却期结束后可以再发", () => {
    const gate = {
      ...baseGate,
      lastAlertAt: baseGate.now - BOT_OFFLINE_ALERT_COOLDOWN_MS,
    };
    expect(shouldSendBotOfflineAlert(gate)).toBe(true);
  });
});

describe("shouldCancelBotOfflineAlert", () => {
  const base = {
    closing: false,
    activeConnections: 0,
    currentOfflineSince: 1_000 as number | undefined,
    expectedOfflineSince: 1_000,
  };

  test("仍然离线且未关停时继续发送", () => {
    expect(shouldCancelBotOfflineAlert(base)).toBe(false);
  });

  test("进程关停时放弃", () => {
    expect(shouldCancelBotOfflineAlert({ ...base, closing: true })).toBe(true);
  });

  test("期间已重连时放弃", () => {
    expect(shouldCancelBotOfflineAlert({ ...base, activeConnections: 1 })).toBe(true);
  });

  test("重连后再次断开（离线起点被刷新）时放弃旧派发", () => {
    expect(shouldCancelBotOfflineAlert({ ...base, currentOfflineSince: 2_000 })).toBe(true);
  });

  test("离线起点被清空（重连过）时放弃", () => {
    expect(shouldCancelBotOfflineAlert({ ...base, currentOfflineSince: undefined })).toBe(true);
  });
});

describe("formatBotOfflineDuration", () => {
  test("不足一分钟按秒显示", () => {
    expect(formatBotOfflineDuration(42_000)).toBe("42 秒");
  });

  test("分钟级补齐两位秒数", () => {
    expect(formatBotOfflineDuration(65_000)).toBe("1 分 05 秒");
  });

  test("小时级只保留小时与分钟", () => {
    expect(formatBotOfflineDuration(2 * 3600_000 + 3 * 60_000)).toBe("2 小时 03 分");
  });

  test("负数按 0 秒处理", () => {
    expect(formatBotOfflineDuration(-5_000)).toBe("0 秒");
  });
});
