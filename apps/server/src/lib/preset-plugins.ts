import type { CampuxPlugin, PluginContext } from "@campux/plugin";

/**
 * 预设插件注册表。
 *
 * 5 个租户级预设插件（Markdown 渲染 / 多彩投稿 / 字体选择 / 匿名头像 / Bot 多彩消息）
 * 与 tenant_metadata.plugin_config 的 5 个 section 一一对应。
 *
 * 默认 disabled：注册进 pluginRegistry 后，管理员在「管理-插件」里点「启用」才会激活，
 * 激活后「管理-插件配置」才会显示对应条目。这个流程由服务端
 * PATCH /api/admin/plugins/settings 双向同步 config.enabled ↔ registry.setStatus。
 */

export const MARKDOWN_RENDER_PLUGIN: CampuxPlugin = {
  name: "campux-plugin-markdown-render",
  version: "1.0.0",
  description: "Markdown 渲染：为投稿稿件启用 Markdown 语法渲染",
  enabledByDefault: false,
  permissions: {
    required: ["config:read", "db:read", "db:write"],
    riskLevel: "low",
    rationale: "仅开关型插件：读取/写入 tenant_metadata.plugin_config，无用户数据接触。",
  },
  hooks: {
    onInit(ctx: PluginContext) { ctx.logger.info("[markdown-render] 初始化完成"); },
    onReady(ctx: PluginContext) { ctx.logger.info("[markdown-render] 已就绪"); },
    onClose(ctx: PluginContext) { ctx.logger.info("[markdown-render] 已关闭"); },
  },
};

export const COLOR_SELECTION_PLUGIN: CampuxPlugin = {
  name: "campux-plugin-color-selection",
  version: "1.0.0",
  description: "多彩投稿：自定义投稿背景色与文字色的预设色板",
  enabledByDefault: false,
  permissions: {
    required: ["config:read", "db:read", "db:write", "tenant:data"],
    riskLevel: "medium",
    rationale: "开启后投稿页向 tenant:data 提交色彩预设 ID，需防止预设被滥用为恶意内容。",
  },
  hooks: {
    onInit(ctx: PluginContext) { ctx.logger.info("[color-selection] 初始化完成"); },
    onReady(ctx: PluginContext) { ctx.logger.info("[color-selection] 已就绪"); },
    onClose(ctx: PluginContext) { ctx.logger.info("[color-selection] 已关闭"); },
  },
};

export const FONT_SELECTION_PLUGIN: CampuxPlugin = {
  name: "campux-plugin-font-selection",
  version: "1.0.0",
  description: "字体选择：从固定字体库中勾选启用的字体",
  enabledByDefault: false,
  permissions: {
    required: ["config:read", "db:read", "db:write", "tenant:data"],
    riskLevel: "low",
    rationale: "仅开放字体白名单，不引入外部字体源。",
  },
  hooks: {
    onInit(ctx: PluginContext) { ctx.logger.info("[font-selection] 初始化完成"); },
    onReady(ctx: PluginContext) { ctx.logger.info("[font-selection] 已就绪"); },
    onClose(ctx: PluginContext) { ctx.logger.info("[font-selection] 已关闭"); },
  },
};

export const ANONYMOUS_AVATAR_PLUGIN: CampuxPlugin = {
  name: "campux-plugin-anonymous-avatar",
  version: "1.0.0",
  description: "匿名头像：投稿页可选匿名头像",
  enabledByDefault: false,
  permissions: {
    required: ["config:read", "db:read", "db:write", "user:data", "tenant:data"],
    riskLevel: "medium",
    rationale: "读取/写入 tenant_metadata.plugin_config；匿名头像会关联到 user:data，需限制访问。",
  },
  hooks: {
    onInit(ctx: PluginContext) { ctx.logger.info("[anonymous-avatar] 初始化完成"); },
    onReady(ctx: PluginContext) { ctx.logger.info("[anonymous-avatar] 已就绪"); },
    onClose(ctx: PluginContext) { ctx.logger.info("[anonymous-avatar] 已关闭"); },
  },
};

export const BOT_STYLISH_MESSAGES_PLUGIN: CampuxPlugin = {
  name: "campux-plugin-bot-stylish-messages",
  version: "1.0.0",
  description: "Bot 多彩消息：为预设消息类型配置多彩内容",
  enabledByDefault: false,
  permissions: {
    required: ["config:read", "db:read", "db:write", "events:emit", "events:listen"],
    riskLevel: "low",
    rationale: "仅写入 tenant_metadata.plugin_config；事件只在本租户内。",
  },
  hooks: {
    onInit(ctx: PluginContext) { ctx.logger.info("[bot-stylish-messages] 初始化完成"); },
    onReady(ctx: PluginContext) { ctx.logger.info("[bot-stylish-messages] 已就绪"); },
    onClose(ctx: PluginContext) { ctx.logger.info("[bot-stylish-messages] 已关闭"); },
  },
};

export const PRESET_PLUGINS: CampuxPlugin[] = [
  MARKDOWN_RENDER_PLUGIN,
  COLOR_SELECTION_PLUGIN,
  FONT_SELECTION_PLUGIN,
  ANONYMOUS_AVATAR_PLUGIN,
  BOT_STYLISH_MESSAGES_PLUGIN,
];

// PluginConfigPage 使用的 camelCase config 段名 → registry 插件 name。
// 服务端 PATCH /api/admin/plugins/settings 用这个映射把 config.enabled 同步到 registry.setStatus。
// 前端 PluginConfigPage 用 PReset_NAME_BY_ID 过滤侧栏：只展示 registry status="enabled" 的插件。
export const PRESET_NAME_BY_ID: Record<string, string> = {
  markdownRender: "campux-plugin-markdown-render",
  colorSelection: "campux-plugin-color-selection",
  fontSelection: "campux-plugin-font-selection",
  anonymousAvatar: "campux-plugin-anonymous-avatar",
  botStylishMessages: "campux-plugin-bot-stylish-messages",
};
