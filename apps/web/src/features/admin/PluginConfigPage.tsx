import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BotIcon,
  InfoIcon,
  LayersIcon,
  LoaderIcon,
  MousePointerClickIcon,
  PaletteIcon,
  SaveIcon,
  ShieldIcon,
  SparklesIcon,
  TypeIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { FONT_OPTIONS } from "@campux/domain";
import type { AuthenticatedMe, BotMessageTypeConfig, PluginColorPreset, TenantMetadata, TenantPluginConfig } from "@/types/app";
import { api } from "@/lib/api";
import { builtInSvgAvatarFilenames } from "@/lib/built-in-svg-avatars";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

type PluginId = "markdownRender" | "colorSelection" | "fontSelection" | "anonymousAvatar" | "botStylishMessages";

interface PluginDescriptor {
  id: PluginId;
  icon: LucideIcon;
  name: string;
  tagline: string;
  description: string;
  hint: string;
  accent: string;
  bgTint: string;
  enabled: (config: TenantPluginConfig) => boolean;
  setEnabled: (config: TenantPluginConfig, enabled: boolean) => TenantPluginConfig;
  render: (config: TenantPluginConfig, onChange: (next: TenantPluginConfig) => void, busy: boolean) => ReactNode;
}

function MarkdownRenderPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-4">
      <SwitchField
        title="启用 Markdown 渲染"
        description="开启后稿件支持 **加粗**、`代码`、列表与链接等常见 Markdown 语法。"
        checked={config.markdownRender.enabled}
        disabled={busy}
        onChange={(value) => onChange({ ...config, markdownRender: { ...config.markdownRender, enabled: value } })}
      />
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        支持的语法：`**加粗**`、`*斜体*`、`` `代码` ``、`- 列表`、`[链接](url)`。不支持表格与自定义 HTML。
      </div>
    </div>
  );
}

function SwitchField({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-slate-200 bg-white p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function ColorPresetEditor({ title, hint, values, max, disabled, onChange }: { title: string; hint: string; values: PluginColorPreset[]; max: number; disabled?: boolean; onChange: (next: PluginColorPreset[]) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className="text-xs text-slate-500">{hint}（最多 {max} 个预设）</p>
        </div>
        <Button size="sm" variant="outline" disabled={disabled || values.length >= max} onClick={() => onChange([...values, { value: `color${values.length + 1}`, label: `预设${values.length + 1}`, hex: "#000000" }])}>
          + 新增预设
        </Button>
      </div>
      {values.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">暂未配置预设。</div>
      ) : (
        <div className="grid gap-2">
          {values.map((preset, index) => (
            <div key={index} className="grid grid-cols-[40px_1fr_1fr_80px_auto] items-center gap-2 rounded-md border border-slate-200 bg-white p-2">
              <span className="h-8 w-8 rounded-md border border-slate-200" style={{ backgroundColor: preset.hex }} />
              <Input value={preset.label} placeholder="名称" disabled={disabled} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} />
              <Input value={preset.value} placeholder="标识" disabled={disabled} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
              <input type="color" value={preset.hex} disabled={disabled} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, hex: event.target.value.toUpperCase() } : item))} />
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorSelectionPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-5">
      <SwitchField title="启用多彩投稿" description="开启后投稿时可选择自定义背景色、文字色，让稿件在墙上更醒目。" checked={config.colorSelection.enabled} disabled={busy} onChange={(value) => onChange({ ...config, colorSelection: { ...config.colorSelection, enabled: value } })} />
      <ColorPresetEditor title="背景色预设" hint="投稿时可选择以下背景色" values={config.colorSelection.backgroundColors} max={10} disabled={busy} onChange={(backgroundColors) => onChange({ ...config, colorSelection: { ...config.colorSelection, backgroundColors } })} />
      <ColorPresetEditor title="文字色预设" hint="投稿时可选择以下文字色" values={config.colorSelection.textColors} max={10} disabled={busy} onChange={(textColors) => onChange({ ...config, colorSelection: { ...config.colorSelection, textColors } })} />
    </div>
  );
}

function FontSelectionPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-4">
      <SwitchField title="启用字体选择" description="开启后投稿时可选择字体；关闭后字体下拉菜单自动隐藏。" checked={config.fontSelection.enabled} disabled={busy} onChange={(value) => onChange({ ...config, fontSelection: { ...config.fontSelection, enabled: value } })} />
      <div>
        <p className="text-sm font-medium text-slate-900">可用字体</p>
        <p className="text-xs text-slate-500">系统固定字体库，勾选启用后作者即可选用。</p>
      </div>
      <div className="grid gap-2">
        {config.fontSelection.fonts.map((option) => {
          const meta = FONT_OPTIONS.find((entry) => entry.value === option.value);
          return (
            <label key={option.value} className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-slate-900">{meta?.label ?? option.value}</p>
                <p className="text-xs text-slate-500">{option.value}</p>
              </div>
              <Switch checked={option.enabled} disabled={busy} onCheckedChange={(value) => onChange({ ...config, fontSelection: { ...config.fontSelection, fonts: config.fontSelection.fonts.map((item) => item.value === option.value ? { ...item, enabled: value } : item) } })} />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function AnonymousAvatarPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  const enabled = config.anonymousAvatar.enabled;
  return (
    <div className="space-y-4">
      <SwitchField title="启用匿名头像" description="开启后匿名投稿时可随机选择一个头像，头像池由下方配置。" checked={enabled} disabled={busy} onChange={(value) => onChange({ ...config, anonymousAvatar: { ...config.anonymousAvatar, enabled: value } })} />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">头像池</p>
          <p className="text-xs text-slate-500">最多 20 个，可自定义顺序。</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy || config.anonymousAvatar.items.length >= 20} onClick={() => onChange({ ...config, anonymousAvatar: { ...config.anonymousAvatar, items: [...config.anonymousAvatar.items, { filename: builtInSvgAvatarFilenames[0] ?? "" }] } })}>
          + 添加头像
        </Button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {config.anonymousAvatar.items.map((item, index) => (
          <div key={index} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
            <img src={`/api/svg/${encodeURIComponent(item.filename)}`} alt={item.filename} className="aspect-square w-full rounded-md object-cover" />
            <div className="mt-1 flex items-center gap-1">
              <select className="h-7 w-full truncate rounded border border-slate-200 bg-white px-1 text-xs text-slate-700" value={item.filename} disabled={busy} onChange={(event) => onChange({ ...config, anonymousAvatar: { ...config.anonymousAvatar, items: config.anonymousAvatar.items.map((it, itemIndex) => itemIndex === index ? { ...it, filename: event.target.value } : it) } })}>
                {builtInSvgAvatarFilenames.map((filename) => (
                  <option key={filename} value={filename}>{filename}</option>
                ))}
              </select>
              <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" disabled={busy} onClick={() => onChange({ ...config, anonymousAvatar: { ...config.anonymousAvatar, items: config.anonymousAvatar.items.filter((_, itemIndex) => itemIndex !== index) } })}>删除</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BotStylishPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-4">
      <SwitchField title="启用 Bot 多彩消息" description="开启后机器人反馈消息可随机使用自定义语句；关闭后回退到默认简洁消息。" checked={config.botStylishMessages.enabled} disabled={busy} onChange={(value) => onChange({ ...config, botStylishMessages: { ...config.botStylishMessages, enabled: value } })} />
      <div>
        <p className="text-sm font-medium text-slate-900">消息类型</p>
        <p className="text-xs text-slate-500">每种消息类型可配置最多 10 条自定义语句，支持占位符：<code>{'{id}'}</code>、<code>{'{reason}'}</code>、<code>{'{target}'}</code>、<code>{'{externalId}'}</code>。</p>
      </div>
      <div className="grid gap-3">
        {config.botStylishMessages.messageTypes.map((entry) => {
          const meta = BOT_MESSAGE_TYPES.find((item) => item.type === entry.type);
          return (
            <div key={entry.type} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-slate-900">{entry.label}</p>
                <p className="text-xs text-slate-500">{meta?.description}</p>
              </div>
              <Switch checked={entry.enabled} disabled={busy} onCheckedChange={(value) => onChange({ ...config, botStylishMessages: { ...config.botStylishMessages, messageTypes: config.botStylishMessages.messageTypes.map((item) => item.type === entry.type ? { ...item, enabled: value } : item) } })} />
            </div>
            <div className="grid gap-2">
              {entry.messages.map((line, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Input value={line} placeholder={`自定义语句 ${index + 1}`} disabled={busy} onChange={(event) => onChange({ ...config, botStylishMessages: { ...config.botStylishMessages, messageTypes: config.botStylishMessages.messageTypes.map((item) => item.type === entry.type ? { ...item, messages: item.messages.map((msg, msgIndex) => msgIndex === index ? event.target.value : msg) } : item) } })} />
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ ...config, botStylishMessages: { ...config.botStylishMessages, messageTypes: config.botStylishMessages.messageTypes.map((item) => item.type === entry.type ? { ...item, messages: item.messages.filter((_, msgIndex) => msgIndex !== index) } : item) } })}>删除</Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2" disabled={busy || entry.messages.length >= 10} onClick={() => onChange({ ...config, botStylishMessages: { ...config.botStylishMessages, messageTypes: config.botStylishMessages.messageTypes.map((item) => item.type === entry.type ? { ...item, messages: [...item.messages, ""] } : item) } })}>
              + 新增语句（{entry.messages.length}/10）
            </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


const BOT_MESSAGE_TYPES: Array<{ type: string; label: string; description: string }> = [
  { type: "submissionSuccess", label: "投稿成功", description: "用户私聊投稿完成后，机器人反馈的语句。支持 {id} 占位符。" },
  { type: "reviewApproved", label: "审核通过", description: "稿件通过审核后发送给作者的语句。支持 {id}。" },
  { type: "reviewRejected", label: "审核拒绝", description: "稿件被拒绝后发送给作者的语句。支持 {id}、{reason}。" },
  { type: "recallSuccess", label: "撤回成功", description: "稿件撤回成功时通知的语句。支持 {id}。" },
  { type: "publishSuccess", label: "发布成功", description: "稿件发布到墙号后通知的语句。支持 {id}、{externalId}。" },
];

const DEFAULT_BOT_MSGS: Record<string, string[]> = {
  submissionSuccess: [
    "投稿成功！当前稿件编号#{id}",
    "✨ 稿件已收到，编号 #{id}",
    "📮 稿件 #{id} 已登记，等待审核",
  ],
  reviewApproved: [
    "您的稿件 #{id} 已通过审核",
    "🎉 稿件 #{id} 审核通过，即将发布",
    "✅ #{id} 准予放行，准备亮相",
  ],
  reviewRejected: [
    "您的稿件 #{id} 未通过审核，原因：{reason}",
    "很遗憾，#{id} 暂未通过审核（{reason}）",
  ],
  recallSuccess: [
    "稿件 #{id} 已撤回",
    "✅ #{id} 已从墙号移除",
  ],
  publishSuccess: [
    "稿件 #{id} 已成功发布（{externalId}）",
    "🚀 #{id} 已发到墙号：{externalId}",
  ],
};

const DEFAULT_BG_COLORS: PluginColorPreset[] = [
  { value: "warm", label: "暖橙", hex: "#F97316" },
  { value: "rose", label: "粉玫", hex: "#EC4899" },
  { value: "violet", label: "薰紫", hex: "#8B5CF6" },
  { value: "mint", label: "薄荷", hex: "#10B981" },
  { value: "sky", label: "天蓝", hex: "#3B82F6" },
];

const DEFAULT_TEXT_COLORS: PluginColorPreset[] = [
  { value: "white", label: "白色", hex: "#FFFFFF" },
  { value: "cream", label: "米黄", hex: "#FDE68A" },
  { value: "black", label: "黑色", hex: "#000000" },
  { value: "deep", label: "深色", hex: "#1F2937" },
];

const PLUGINS: PluginDescriptor[] = [
  {
    id: "markdownRender",
    icon: TypeIcon,
    name: "Markdown 渲染插件",
    tagline: "Markdown",
    description: "为投稿稿件启用 Markdown 语法渲染",
    hint: "默认支持加粗、斜体、列表、代码与链接。",
    accent: "from-violet-500 to-indigo-500",
    bgTint: "bg-violet-50 text-violet-700",
    enabled: (config) => config.markdownRender.enabled,
    setEnabled: (config, value) => ({ ...config, markdownRender: { ...config.markdownRender, enabled: value } }),
    render: (config, onChange, busy) => <MarkdownRenderPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "colorSelection",
    icon: PaletteIcon,
    name: "多彩投稿插件",
    tagline: "Colors",
    description: "自定义投稿背景色与文字色的预设色板",
    hint: "背景色与文字色各支持最多 10 个预设，可按需自定义。",
    accent: "from-pink-500 to-orange-500",
    bgTint: "bg-pink-50 text-pink-700",
    enabled: (config) => config.colorSelection.enabled,
    setEnabled: (config, value) => ({ ...config, colorSelection: { ...config.colorSelection, enabled: value } }),
    render: (config, onChange, busy) => <ColorSelectionPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "fontSelection",
    icon: MousePointerClickIcon,
    name: "字体选择插件",
    tagline: "Fonts",
    description: "从固定字体库中勾选启用的字体",
    hint: "系统固定字体库，勾选后投稿页自动展示选项。",
    accent: "from-emerald-500 to-teal-500",
    bgTint: "bg-emerald-50 text-emerald-700",
    enabled: (config) => config.fontSelection.enabled,
    setEnabled: (config, value) => ({ ...config, fontSelection: { ...config.fontSelection, enabled: value } }),
    render: (config, onChange, busy) => <FontSelectionPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "anonymousAvatar",
    icon: UsersIcon,
    name: "匿名头像插件",
    tagline: "Avatars",
    description: "自定义匿名投稿使用的 SVG 头像池",
    hint: "最多 20 个头像，可无限修改。",
    accent: "from-sky-500 to-cyan-500",
    bgTint: "bg-sky-50 text-sky-700",
    enabled: (config) => config.anonymousAvatar.enabled,
    setEnabled: (config, value) => ({ ...config, anonymousAvatar: { ...config.anonymousAvatar, enabled: value } }),
    render: (config, onChange, busy) => <AnonymousAvatarPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "botStylishMessages",
    icon: BotIcon,
    name: "Bot 多彩消息插件",
    tagline: "Bot",
    description: "自定义机器人反馈消息的多彩语句",
    hint: "每种消息类型最多 10 条自定义语句，支持占位符。",
    accent: "from-amber-500 to-rose-500",
    bgTint: "bg-amber-50 text-amber-700",
    enabled: (config) => config.botStylishMessages.enabled,
    setEnabled: (config, value) => ({ ...config, botStylishMessages: { ...config.botStylishMessages, enabled: value } }),
    render: (config, onChange, busy) => <BotStylishPanel config={config} onChange={onChange} busy={busy} />,
  },
];

function ensureBotMessageDefaults(config: TenantPluginConfig): TenantPluginConfig {
  const existing = new Map(config.botStylishMessages.messageTypes.map((item) => [item.type, item]));
  const messageTypes: BotMessageTypeConfig[] = BOT_MESSAGE_TYPES.map((entry) => {
    const current = existing.get(entry.type);
    return {
      type: entry.type,
      label: current?.label || entry.label,
      enabled: current?.enabled ?? false,
      messages: current?.messages && current.messages.length > 0 ? current.messages : (DEFAULT_BOT_MSGS[entry.type] ?? []),
    };
  });
  return { ...config, botStylishMessages: { ...config.botStylishMessages, messageTypes } };
}

function buildInitialConfig(metadata: TenantMetadata): TenantPluginConfig {
  return {
    markdownRender: { enabled: metadata.enableMarkdownRender ?? false },
    colorSelection: {
      enabled: metadata.enableColorSelection ?? false,
      backgroundColors: DEFAULT_BG_COLORS,
      textColors: DEFAULT_TEXT_COLORS,
    },
    fontSelection: {
      enabled: metadata.enableFontSelection ?? false,
      fonts: FONT_OPTIONS.map((option) => ({ value: option.value, enabled: option.value === "default" })),
    },
    anonymousAvatar: {
      enabled: metadata.enableAnonymousAvatarSelection ?? false,
      items: builtInSvgAvatarFilenames.slice(0, 10).map((filename) => ({ filename })),
    },
    botStylishMessages: {
      enabled: metadata.botStylishMessagesEnabled ?? false,
      messageTypes: [],
    },
  };
}

export function PluginConfigPage({ me, metadata, onSaved }: { me: AuthenticatedMe; metadata: TenantMetadata; onSaved?: () => void | Promise<void> }) {
  const [config, setConfig] = useState<TenantPluginConfig>(() => ensureBotMessageDefaults(buildInitialConfig(metadata)));
  const [activeId, setActiveId] = useState<PluginId>("markdownRender");
  const [showInfo, setShowInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const tenantId = me.currentTenant?.id;

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ config: TenantPluginConfig }>("/api/admin/plugins/settings")
      .then((data) => {
        if (!cancelled) setConfig(ensureBotMessageDefaults(data.config));
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "读取插件配置失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/plugins/settings", { method: "PATCH", body: JSON.stringify(config) });
      toast.success("插件配置已保存");
      await onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "插件配置保存失败");
    } finally {
      setBusy(false);
    }
  }

  const active = PLUGINS.find((plugin) => plugin.id === activeId) ?? PLUGINS[0]!;

  return (
    <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      <Card className="rounded-md border-slate-200 bg-white shadow-none">
        <CardContent className="flex h-full flex-col p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md bg-gradient-to-br from-slate-700 to-slate-900 text-white"><LayersIcon className="size-4" /></span>
              <div>
                <p className="text-sm font-semibold text-slate-900">插件管理</p>
                <p className="text-xs text-slate-500">共 {PLUGINS.length} 个插件</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowInfo((value) => !value)}>说明</Button>
          </div>
          <div className="grid gap-1 overflow-y-auto">
            {PLUGINS.map((plugin) => {
              const enabled = plugin.enabled(config);
              const isActive = plugin.id === active.id;
              return (
                <div key={plugin.id} className="group">
                  <button type="button" onClick={() => setActiveId(plugin.id)} className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-slate-50" data-active={isActive || undefined}>
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-gradient-to-br text-white" style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}><plugin.icon className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{plugin.name}</p>
                      <p className="truncate text-xs text-slate-500">{plugin.tagline}</p>
                    </div>
                    <span className={enabled ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"}>{enabled ? "已启用" : "未启用"}</span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 border-t border-slate-200 pt-3">
            <Button className="w-full" disabled={busy || loading} onClick={() => void save()}><SaveIcon className="size-4" />{busy ? "保存中…" : "保存配置"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-md border-slate-200 bg-white shadow-none">
        <CardContent className="flex h-full flex-col p-4">
          {loading ? (
            <div className="grid flex-1 place-items-center text-sm text-slate-500"><LoaderIcon className="size-5 animate-spin" /> 加载插件配置中…</div>
          ) : showInfo ? (
            <div className="flex-1 space-y-4 overflow-y-auto">
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-md bg-gradient-to-br from-slate-700 to-slate-900 text-white"><LayersIcon className="size-5" /></span>
                <div>
                  <p className="text-base font-semibold text-slate-900">插件说明</p>
                  <p className="text-xs text-slate-500">开启后可进入配置页；配置内容实时预览。</p>
                </div>
              </div>
              <div className="grid gap-3">
                {PLUGINS.map((plugin) => (
                  <div key={plugin.id} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid size-8 place-items-center rounded-md bg-gradient-to-br text-white" style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}><plugin.icon className="size-4" /></span>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{plugin.name}</p>
                        <p className="text-xs text-slate-500">{plugin.hint}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">{plugin.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 space-y-4 overflow-y-auto">
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-md bg-gradient-to-br text-white" style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}><active.icon className="size-5" /></span>
                <div className="flex-1">
                  <p className="text-base font-semibold text-slate-900">{active.name}</p>
                  <p className="text-xs text-slate-500">{active.description}</p>
                </div>
                <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => void save()}><SaveIcon className="size-4" />保存</Button>
              </div>
              {active.render(config, setConfig, busy)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

