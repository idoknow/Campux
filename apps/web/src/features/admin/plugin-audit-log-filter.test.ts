import { describe, expect, test } from "bun:test";
import { filterPluginAuditLogs } from "./plugin-audit-log-filter";

const PRESET_NAME_BY_ID: Record<string, string> = {
  markdownRender: "campux-plugin-markdown-render",
  colorSelection: "campux-plugin-color-selection",
  campaigns: "campux-plugin-campaigns",
};

describe("filterPluginAuditLogs", () => {
  const auditLog = [
    {
      id: "1",
      pluginName: "campux-plugin-markdown-render",
      action: "tenant.plugin.markdownRender.enable",
    },
    {
      id: "2",
      pluginName: "campux-plugin-color-selection",
      action: "tenant.plugin.colorSelection.config",
    },
  ];

  test("matches registry pluginName, not Chinese display name", () => {
    const filtered = filterPluginAuditLogs(auditLog, "markdownRender", PRESET_NAME_BY_ID.markdownRender!);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.pluginName).toBe("campux-plugin-markdown-render");
  });

  test("legacy display-name filter would incorrectly return empty", () => {
    const wrong = auditLog.filter((entry) => entry.pluginName === "Markdown 渲染");
    expect(wrong).toHaveLength(0);
  });

  test("falls back to action token when pluginName is missing", () => {
    const withNullName = [{ id: "4", pluginName: null, action: "tenant.plugin.campaigns.enable" }];
    const filtered = filterPluginAuditLogs(withNullName, "campaigns", PRESET_NAME_BY_ID.campaigns!);
    expect(filtered).toHaveLength(1);
  });

  test("does not leak other plugins into current scope", () => {
    const filtered = filterPluginAuditLogs(auditLog, "colorSelection", PRESET_NAME_BY_ID.colorSelection!);
    expect(filtered.map((entry) => entry.id)).toEqual(["2"]);
  });
});
