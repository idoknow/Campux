/** 审计日志「当前插件」过滤：pluginName 是 registry 名，不是界面展示名。 */
export function filterPluginAuditLogs<T extends { pluginName: string | null; action: string }>(
  auditLog: readonly T[],
  pluginId: string,
  registryName: string,
): T[] {
  return auditLog.filter(
    (entry) => entry.pluginName === registryName || entry.action.includes(`.${pluginId}.`),
  );
}
