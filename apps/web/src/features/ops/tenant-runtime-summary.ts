import type { SystemTenant } from "../../types/app";

export type TenantRuntimeSummary = {
  onlineBots: number;
  totalBots: number;
  lastConnectedAt: string | null;
  readyTargets: number;
  unavailableTargets: number;
  disabledTargets: number;
  totalTargets: number;
};

export function summarizeTenantRuntime(tenant: SystemTenant): TenantRuntimeSummary {
  const targets = tenant.bots.flatMap((bot) => bot.publishTargets);
  const lastConnectedAt = tenant.bots.reduce<string | null>((latest, bot) => {
    if (!bot.lastSeenAt) return latest;
    if (!latest) return bot.lastSeenAt;
    return Date.parse(bot.lastSeenAt) > Date.parse(latest) ? bot.lastSeenAt : latest;
  }, null);

  return {
    onlineBots: tenant.bots.filter((bot) => bot.connection.online).length,
    totalBots: tenant.bots.length,
    lastConnectedAt,
    readyTargets: targets.filter((target) => target.status === "ready").length,
    unavailableTargets: targets.filter((target) => target.status === "unavailable").length,
    disabledTargets: targets.filter((target) => target.status === "disabled").length,
    totalTargets: targets.length,
  };
}
