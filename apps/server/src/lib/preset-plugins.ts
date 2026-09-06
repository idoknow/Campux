/**
 * 预设插件元数据。
 *
 * 6 个租户级预设插件（Markdown 渲染 / 多彩投稿 / 字体选择 / 匿名头像 / Bot 多彩消息 / 投票竞选）
 * 已经存在 tenant_metadata.plugin_config 里，不作为 CampuxPlugin 实例注册进 pluginRegistry。
 * 每个租户的「已注册插件」= registry 已注册插件 + 6 个预设插件；
 * 预设插件的「已启用」= plugin_config.*.enabled === true。
 *
 * 服务端 GET /api/admin/plugins 会把预设插件合入返回，PATCH /api/admin/plugins/:name/status
 * 对预设插件名生效并写回 config.enabled；对 registry 插件名走 pluginRegistry.setStatus。
 */

import type { PluginPermission, PluginRiskLevel } from "@campux/plugin";

export type PresetPluginId =
  | "markdownRender"
  | "colorSelection"
  | "fontSelection"
  | "anonymousAvatar"
  | "botStylishMessages"
  | "campaigns";

export interface PresetPluginEntry {
  /** tenant_metadata.plugin_config 的 section 名 */
  id: PresetPluginId;
  /** /api/admin/plugins 展示的 name（同时用作 PATCH /status 的 name 参数） */
  name: string;
  version: string;
  description: string;
  required: PluginPermission[];
  riskLevel: PluginRiskLevel;
  rationale: string;
}

export const PRESET_PLUGINS: PresetPluginEntry[] = [
  {
    id: "markdownRender",
    name: "campux-plugin-markdown-render",
    version: "1.0.0",
    description: "Markdown 渲染：为投稿稿件启用 Markdown 语法渲染",
    required: ["config:read", "db:read", "db:write"],
    riskLevel: "low",
    rationale: "仅开关型插件：读取/写入 tenant_metadata.plugin_config，无用户数据接触。",
  },
  {
    id: "colorSelection",
    name: "campux-plugin-color-selection",
    version: "1.0.0",
    description: "多彩投稿：自定义投稿背景色与文字色的预设色板",
    required: ["config:read", "db:read", "db:write", "tenant:data"],
    riskLevel: "medium",
    rationale: "开启后投稿页向 tenant:data 提交色彩预设 ID，需防止预设被滥用为恶意内容。",
  },
  {
    id: "fontSelection",
    name: "campux-plugin-font-selection",
    version: "1.0.0",
    description: "字体选择：从固定字体库中勾选启用的字体",
    required: ["config:read", "db:read", "db:write", "tenant:data"],
    riskLevel: "low",
    rationale: "仅开放字体白名单，不引入外部字体源。",
  },
  {
    id: "anonymousAvatar",
    name: "campux-plugin-anonymous-avatar",
    version: "1.0.0",
    description: "匿名头像：投稿页可选匿名头像",
    required: ["config:read", "db:read", "db:write", "user:data", "tenant:data"],
    riskLevel: "medium",
    rationale: "读取/写入 tenant_metadata.plugin_config；匿名头像会关联到 user:data，需限制访问。",
  },
  {
    id: "botStylishMessages",
    name: "campux-plugin-bot-stylish-messages",
    version: "1.0.0",
    description: "Bot 多彩消息：为预设消息类型配置多彩内容",
    required: ["config:read", "db:read", "db:write", "events:emit", "events:listen"],
    riskLevel: "low",
    rationale: "仅写入 tenant_metadata.plugin_config；事件只在本租户内。",
  },
  {
    id: "campaigns",
    name: "campux-plugin-campaigns",
    version: "1.0.0",
    description: "投票竞选：投稿页发起投票竞选，经审核群/网页审核通过后在服务页公开投票",
    required: ["config:read", "db:read", "db:write", "tenant:data", "user:data", "events:emit"],
    riskLevel: "medium",
    rationale: "开启后投稿页新增发起入口与服务页浏览入口；竞选内容、投票明细与发起人 QQ 私聊均接入 tenant 数据。",
  },
];

export const PRESET_NAME_BY_ID: Record<PresetPluginId, string> = Object.fromEntries(
  PRESET_PLUGINS.map((entry) => [entry.id, entry.name])
) as Record<PresetPluginId, string>;

export const PRESET_ID_BY_NAME: Record<string, PresetPluginId> = Object.fromEntries(
  PRESET_PLUGINS.map((entry) => [entry.name, entry.id])
);
