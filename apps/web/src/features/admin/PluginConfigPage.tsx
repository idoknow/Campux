import { useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  InfoIcon,
  KeyRoundIcon,
  LoaderIcon,
  SaveIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { FONT_OPTIONS } from "@campux/domain";
import type { BotMessageTypeConfig, PluginColorPreset, TenantMetadata, TenantPluginConfig } from "@/types/app";
import { api } from "@/lib/api";
import { builtInSvgAvatarFilenames } from "@/lib/built-in-svg-avatars";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

type PluginIconProps = { className?: string };

export function ColorIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none"><path d="M512 1024C76.96384 1024 0 947.022507 0 512S76.96384 0 512 0 1024 76.96384 1024 512 947.022507 1024 512 1024z m0-998.4C98.727253 25.6 25.6 98.7136 25.6 512S98.727253 998.4 512 998.4 998.4 925.272747 998.4 512 925.272747 25.6 512 25.6z" fill="#C1D4FC" /><path d="M279.893333 785.066667c-101.034667 0-177.793707-5.270187-236.05248-21.149014C30.26944 698.69568 25.6 616.174933 25.6 512 25.6 98.7136 98.727253 25.6 512 25.6c31.402667 0 60.648107 0.49152 88.255147 1.447253C671.45728 83.367253 689.493333 187.665067 689.493333 375.466667c0 348.023467-61.576533 409.6-409.6 409.6z" fill="#4D7DDD" opacity=".1" /><path d="M811.362987 510.948693L571.378347 764.586667h-163.84l-101.512534-115.165867a27.306667 27.306667 0 0 1 0-38.611627l302.598827-302.598826a27.306667 27.306667 0 0 1 38.611627 0l164.12672 164.113066a27.306667 27.306667 0 0 1 0 38.62528z" fill="#C1D4FC" /></svg>
  );
}

export function FontIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none">
      <path d="M442.688 885.76l64.96-62.848-150.016-8.128c45.824-21.632 76.8-43.968 92.864-66.88 16.064-22.912 27.2-59.84 33.28-110.72l5.504-47.744 4.288-39.552h28.16l41.728 1.088 52.544 1.088 46.08 1.088c37.504 0 77.632-25.472 120.192-76.352-57.024 9.728-112.448 14.592-166.272 14.592H500.096l32-287.616h51.968c100.032 0 162.688 3.008 187.968 8.96 25.216 5.952 37.888 20.864 37.888 44.672 0 10.496-2.176 24.96-6.528 43.328 2.944 0.384 5.632 0.576 8.128 0.576 14.08 0 25.6-10.688 34.688-32l8.64-20.032 43.392-111.04c-69.76 4.736-138.176 7.04-205.312 7.04H513.6c-113.024 0-200.192 22.784-261.632 68.288-84.096 62.464-126.208 144.256-126.208 245.376 0 26.688 4.16 54.144 12.48 82.304l87.744-84.48c-16.64-31.424-24.96-62.08-24.96-92.16 0-49.792 20.032-89.024 59.904-117.76 39.936-28.672 94.912-43.072 164.928-43.072h18.432L401.472 589.44l-5.952 53.12c-10.112 85.952-37.12 142.784-81.28 170.624l-58.432-6.528-69.888 67.2 256.768 11.904z" fill="#d4237a" />
    </svg>
  );
}

export function AnonymousAvatarIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none">
      <path d="M64.5 512.7C64.5 760 265 960.4 512.2 960.4S960 760 960 512.7 759.5 65 512.2 65 64.5 265.4 64.5 512.7z" fill="#8C8E93" />
      <path d="M677.9 220.1c-14.4-1.5-50.8 55.3-50.8 55.3-37.2-11.4-76-16.8-114.9-16.3-38.9-0.6-77.7 4.9-114.9 16.3 0 0-36.4-56.8-50.8-55.3-14.4 1.5-65.4 194.8-106.1 648.3 160.5 122.7 383.3 122.7 543.8 0-40.8-453.6-91.6-646.7-106.3-648.3z" fill="#F2F2F2" />
      <path d="M802.1 343.8c-4.7-1-9.5-1.6-14.3-1.9-24.5-1.6-49.3-3.1-73.7-3.7-48.4-1-97.7 1.6-144.2 16.2-19.6 6.1-37.7 13-57.7 12.7-20 0.4-38.1-6.5-57.7-12.7-46.2-14.5-95-17.6-143-16.3-24.2 0.5-48.3 2.1-72.4 3.8-19.3 1.4-38.4 3.9-39.4 28-0.7 7.3 2.5 14.4 8.5 18.7 4.5 3.3 12.7 2.1 16.5 6.1 3.8 4 2.8 11.2 3 16.7 1.9 43.8 8.1 92.1 48.9 117.7 33.2 20.9 75.4 23.6 113.5 23.1 35.8-0.4 63.5-17.9 78.8-50.9 7.6-16.5 9.5-34.5 14.3-51.5 0 0 12.1-43.2 29.1-43.1s29.1 43.1 29.1 43.1c4.8 17.1 6.8 35.1 14.3 51.5 15.2 33 42.8 50.4 78.8 50.9 38.1 0.5 80.4-2.3 113.5-23.1 40.8-25.7 47-73.9 48.9-117.7 0.2-5.6-1-12.6 3-16.7 4-4.2 12-2.8 16.5-6.1 5.9-4.3 9.1-11.4 8.5-18.7-0.9-16.5-10.4-23.2-22.8-26.1z" fill="#282C33" />
    </svg>
  );
}

export function PluginConfigIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <path d="M512 1024C76.96384 1024 0 947.03616 0 512S76.96384 0 512 0 1024 76.96384 1024 512 947.022507 1024 512 1024z m0-998.4C98.7136 25.6 25.6 98.7136 25.6 512S98.7136 998.4 512 998.4 998.4 925.272747 998.4 512 925.272747 25.6 512 25.6z" fill="#C1D4FC" />
      <path d="M279.893333 785.066667c-101.034667 0-177.793707-5.270187-236.05248-21.149014C30.26944 698.69568 25.6 616.174933 25.6 512 25.6 98.7136 98.7136 25.6 512 25.6c31.402667 0 60.648107 0.49152 88.255147 1.460907C671.45728 83.367253 689.493333 187.665067 689.493333 375.466667c0 348.023467-61.576533 409.6-409.6 409.6z" fill="#4D7DDD" opacity="0.1" />
      <path d="M339.503787 523.946667l228.816213-228.816214 228.816213 228.816214-228.816213 228.816213z" fill="#C1D4FC" />
    </svg>
  );
}

export function MarkdownIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none">
      <path d="M658.645333 64h-389.333333A141.333333 141.333333 0 0 0 128 205.333333v612.949334a141.333333 141.333333 0 0 0 141.333333 141.333333h485.482667a141.333333 141.333333 0 0 0 141.333333-141.333333V301.482667a119.957333 119.957333 0 0 0-35.157333-84.842667l-117.482667-117.504A120 120 0 0 0 658.645333 64z" fill="#53B7F4" />
      <path d="M376.426667 691.349333c13.226667 0 24-10.752 24-24V441.088l94.336 93.290667c9.344 9.216 24.341333 9.258667 33.706666 0.042666l95.253334-93.589333v227.178667a24 24 0 0 0 48 0V383.594667a24 24 0 0 0-40.832-17.109334l-119.210667 117.12-118.4-117.077333a24 24 0 0 0-40.853333 17.066667v283.754666c0 13.248 10.730667 24 24 24z m484.565333-474.709333l-117.482667-117.504a120 120 0 0 0-61.76-32.896v131.882667a75.818667 75.818667 0 0 0 75.818667 75.797333h135.36a119.978667 119.978667 0 0 0-31.936-57.28z" fill="#29A3D3" />
      <path d="M376.405333 347.605333c6.186667 0 12.309333 2.389333 16.874667 6.933334l118.4 117.056 119.210667-117.12a24 24 0 0 1 40.832 17.130666V656a24 24 0 0 1-48 0V428.8l-95.253334 93.610667c-9.386667 9.194667-24.384 9.173333-33.706666-0.042667l-94.336-93.290667V655.36a24 24 0 0 1-48 0V371.605333a24.021333 24.021333 0 0 1 23.978666-24z" fill="#FFFFFF" />
    </svg>
  );
}

export function BotIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none">
      <path d="M780.8 192.1024H299.2128c-66.816 0-121.4976 54.6816-121.4976 121.4976v291.072c0 80.1792 65.5872 145.7664 145.7664 145.7664h17.92l112.64 108.8512c17.664 17.0496 40.4992 25.6 63.3856 25.6 22.2208 0 44.4928-8.0896 62.0032-24.32l118.8864-110.1312h87.5008c87.5008 0 158.464-70.9632 158.464-158.464V355.584c0-89.9072-73.5744-163.4816-163.4816-163.4816z" fill="#9bc6fc" />
      <path d="M741.4272 333.3632H325.3248c-19.8144 0-35.84 16.0256-35.84 35.84s16.0256 35.84 35.84 35.84h416.1536c19.8144 0 35.84-16.0256 35.84-35.84a35.8912 35.8912 0 0 0-35.8912-35.84zM567.3472 526.6944H330.4448c-19.8144 0-35.84 16.0256-35.84 35.84s16.0256 35.84 35.84 35.84h236.9024c19.8144 0 35.84-16.0256 35.84-35.84s-16.0768-35.84-35.84-35.84z" fill="#FEC963" />
      <path d="M517.5808 896.3072c-28.9792 0-56.4224-11.1104-77.2608-31.232l-102.0928-98.6624H259.7376c-97.1264 0-176.128-79.0016-176.128-176.128V298.7008c0-97.1264 79.0016-176.128 176.128-176.128h517.12c97.1264 0 176.128 79.0016 176.128 176.128v291.584c0 97.1264-79.0016 176.128-176.128 176.128h-75.52l-108.2368 100.3008a110.68416 110.68416 0 0 1-75.52 29.5936zM259.7376 168.6528c-71.7312 0-130.048 58.3168-130.048 130.048v291.584c0 71.7312 58.3168 130.048 130.048 130.048h87.7568c5.9904 0 11.7248 2.304 16.0256 6.4512l108.8 105.1648a64.8192 64.8192 0 0 0 45.2608 18.2784c16.4864 0 32.1536-6.144 44.2368-17.3568l114.8416-106.4448c4.2496-3.9424 9.8304-6.144 15.6672-6.144h84.5312c71.7312 0 130.048-58.3168 130.048-130.048V298.7008c0-71.7312-58.3168-130.048-130.048-130.048h-517.12z" fill="#474747" />
      <path d="M731.4944 372.4288H315.3408c-12.7488 0-23.04-10.2912-23.04-23.04s10.2912-23.04 23.04-23.04h416.1536a23.04 23.04 0 0 1 0 46.08zM557.3632 565.76H320.4608c-12.7488 0-23.04-10.2912-23.04-23.04s10.2912-23.04 23.04-23.04h236.9024c12.7488 0 23.04 10.2912 23.04 23.04s-10.2912 23.04-23.04 23.04z" fill="#474747" />
    </svg>
  );
}

type PluginId = "markdownRender" | "colorSelection" | "fontSelection" | "anonymousAvatar" | "botStylishMessages";
type PluginPermission = "db:read" | "db:write" | "events:emit" | "events:listen" | "http:route" | "config:read" | "tenant:data" | "user:data";

type PluginRisk = "low" | "medium" | "high";

interface PluginDescriptor {
  id: PluginId;
  icon: React.ComponentType<PluginIconProps>;
  name: string;
  tagline: string;
  description: string;
  /** 详细功能说明，弹窗中展示。 */
  detailedDescription: string;
  /** 作者署名。 */
  author: string;
  hint: string;
  accent: string;
  bgTint: string;
  role: "admin";
  required: PluginPermission[];
  riskLevel: PluginRisk;
  rationale: string;
  enabled: (config: TenantPluginConfig) => boolean;
  setEnabled: (config: TenantPluginConfig, enabled: boolean) => TenantPluginConfig;
  render: (config: TenantPluginConfig, onChange: (next: TenantPluginConfig) => void, busy: boolean) => ReactNode;
}

function PermissionBadge({ permissions, risk, rationale }: { permissions: PluginPermission[]; risk: PluginRisk; rationale: string }) {
  const riskStyles: Record<PluginRisk, string> = {
    low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    medium: "bg-amber-50 text-amber-700 ring-amber-200",
    high: "bg-rose-50 text-rose-700 ring-rose-200",
  };
  const riskLabel: Record<PluginRisk, string> = { low: "低风险", medium: "中风险", high: "高风险" };
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-4 text-slate-500" />
        <p className="text-sm font-medium text-slate-900">所需权限</p>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${riskStyles[risk]}`}>{riskLabel[risk]}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {permissions.map((permission) => (
          <span key={permission} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
            <KeyRoundIcon className="size-3" />
            {PERMISSION_LABELS[permission] ?? permission}
            <span className="font-mono text-slate-400">{permission}</span>
          </span>
        ))}
      </div>
      <p className="text-xs leading-5 text-slate-600">{rationale}</p>
    </div>
  );
}

// 预设插件 ID → registry 插件 name。与服务端 apps/server/src/lib/preset-plugins.ts
// 中的 PRESET_NAME_BY_ID 保持同形，前端用这个映射调用 /api/admin/plugins 判断当前租户是否已启用。
type PresetNameByConfigId = Record<PluginId, string>;
const PRESET_NAME_BY_ID: PresetNameByConfigId = {
  markdownRender: "campux-plugin-markdown-render",
  colorSelection: "campux-plugin-color-selection",
  fontSelection: "campux-plugin-font-selection",
  anonymousAvatar: "campux-plugin-anonymous-avatar",
  botStylishMessages: "campux-plugin-bot-stylish-messages",
};

const PERMISSION_LABELS: Record<PluginPermission, string> = {
  "db:read": "读取元数据",
  "db:write": "写入元数据",
  "events:emit": "发布事件",
  "events:listen": "订阅事件",
  "http:route": "注册路由",
  "config:read": "读取配置",
  "tenant:data": "访问租户数据",
  "user:data": "访问用户数据",
};

function MarkdownRenderPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-4">
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
      <ColorPresetEditor title="背景色预设" hint="投稿时可选择以下背景色" values={config.colorSelection.backgroundColors} max={10} disabled={busy} onChange={(backgroundColors) => onChange({ ...config, colorSelection: { ...config.colorSelection, backgroundColors } })} />
      <ColorPresetEditor title="文字色预设" hint="投稿时可选择以下文字色" values={config.colorSelection.textColors} max={10} disabled={busy} onChange={(textColors) => onChange({ ...config, colorSelection: { ...config.colorSelection, textColors } })} />
    </div>
  );
}

function FontSelectionPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-4">
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
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const [customSvgText, setCustomSvgText] = useState("");
  const [customError, setCustomError] = useState("");

  function handleAddCustom() {
    const text = customSvgText.trim();
    if (!text) {
      setCustomError("请粘贴 SVG 源码");
      return;
    }
    if (!text.toLowerCase().startsWith("<svg")) {
      setCustomError("仅支持以 <svg 开头的 SVG 源码");
      return;
    }
    if (text.length > 60000) {
      setCustomError("SVG 源码过大（建议不超过 60KB）");
      return;
    }
    if (config.anonymousAvatar.items.length >= 20) {
      setCustomError("头像池已满（最多 20 个）");
      return;
    }
    const base64 = btoa(unescape(encodeURIComponent(text)));
    const svg = `data:image/svg+xml;base64,${base64}`;
    // 基于 SVG 内容生成短 hash 作为稳定 id（取首 20 个十六进制字符）
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    const id = `custom-${hash.toString(16).padStart(8, "0")}${Date.now().toString(36).slice(-4)}`;
    onChange({
      ...config,
      anonymousAvatar: {
        ...config.anonymousAvatar,
        items: [...config.anonymousAvatar.items, { id, svg }],
      },
    });
    setCustomSvgText("");
    setCustomError("");
    setCustomEditorOpen(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-900">头像池</p>
        <p className="text-xs text-slate-500">最多 20 个，可自定义顺序；支持从内置库选择或粘贴 SVG 源码。</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy || config.anonymousAvatar.items.length >= 20} onClick={() => onChange({ ...config, anonymousAvatar: { ...config.anonymousAvatar, items: [...config.anonymousAvatar.items, { id: builtInSvgAvatarFilenames[0] ?? "" }] } })}>
          从内置库添加
        </Button>
        <Button size="sm" variant="outline" disabled={busy || config.anonymousAvatar.items.length >= 20} onClick={() => setCustomEditorOpen((value) => !value)}>
          粘贴 SVG 源码
        </Button>
      </div>
      {customEditorOpen ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">粘贴以 &lt;svg 开头的完整 SVG 源码，最多 60KB。</p>
          <textarea
            className="h-40 w-full resize-y rounded-md border border-slate-300 bg-white p-2 font-mono text-xs text-slate-900"
            placeholder={'<svg xmlns="http://www.w3.org/2000/svg" ...>...</svg>'}
            value={customSvgText}
            onChange={(event) => { setCustomSvgText(event.target.value); setCustomError(""); }}
            disabled={busy}
          />
          {customError ? <p className="text-xs text-red-600">{customError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setCustomEditorOpen(false); setCustomError(""); }}>取消</Button>
            <Button size="sm" onClick={handleAddCustom}>添加</Button>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-4 gap-2">
        {config.anonymousAvatar.items.map((item, index) => {
          const isCustom = Boolean(item.svg);
          const previewSrc = item.svg ?? `/api/svg/${encodeURIComponent(item.id)}`;
          const label = isCustom ? `自定义头像 ${index + 1}` : item.id;
          return (
            <div key={`${item.id}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
              <img src={previewSrc} alt={label} className="aspect-square w-full rounded-md object-cover" />
              <div className="mt-1 flex items-center gap-1">
                {isCustom ? (
                  <span className="h-7 flex-1 truncate rounded border border-slate-200 bg-slate-100 px-1 text-xs text-slate-600" title={item.id}>{label}</span>
                ) : (
                  <select className="h-7 w-full truncate rounded border border-slate-200 bg-white px-1 text-xs text-slate-700" value={item.id} disabled={busy} onChange={(event) => onChange({ ...config, anonymousAvatar: { ...config.anonymousAvatar, items: config.anonymousAvatar.items.map((it, itemIndex) => itemIndex === index ? { ...it, id: event.target.value, svg: undefined as string | undefined } : it) } })}>
                    {builtInSvgAvatarFilenames.map((filename) => (
                      <option key={filename} value={filename}>{filename}</option>
                    ))}
                  </select>
                )}
                <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" disabled={busy} title="删除" onClick={() => onChange({ ...config, anonymousAvatar: { ...config.anonymousAvatar, items: config.anonymousAvatar.items.filter((_, itemIndex) => itemIndex !== index) } })}>
                  删除
                </Button>              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BotStylishPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-4">
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

const DEFAULT_PLUGIN_AUTHOR = "MrWoods1692";

const PLUGINS: PluginDescriptor[] = [
  {
    id: "markdownRender",
    icon: MarkdownIcon,
    name: "Markdown 渲染",
    tagline: "Markdown",
    description: "为投稿稿件启用 Markdown 语法渲染",
    detailedDescription:
      "本插件在稿件墙展示与投稿详情页中启用 Markdown 语法解析。作者可在投稿时直接使用 Markdown 语法排版文字，无需掌握富文本编辑器。\n\n" +
      "支持的语法：\n" +
      "· **加粗** — 用两个星号包裹文字，如 **重点内容**。\n" +
      "· *斜体* — 用单个星号包裹文字。\n" +
      "· `行内代码` — 用反引号包裹，用于强调命令、变量、路径等。\n" +
      "· - 无序列表 — 每行以短横线加空格开头。\n" +
      "· 1. 有序列表 — 每行以数字加句点开头。\n" +
      "· [链接文本](https://example.com) — 点击可跳转外部地址。\n" +
      "· > 引用 — 每行以大于号加空格开头。\n" +
      "\n" +
      "不支持的语法：\n" +
      "· 表格与自定义 HTML（例如 <div>、<br/>）会被安全地过滤或转义，避免出现任意脚本。\n" +
      "· 图片语法（![]()）不会渲染为图片，请通过投稿页的图片上传功能添加图片。\n" +
      "\n" +
      "使用建议：投稿时先按 Markdown 语法排版，保存后稿件卡片会按解析后的样式展示，保持版面整洁。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "默认支持加粗、斜体、列表、代码与链接。",
    accent: "from-violet-500 to-indigo-500",
    bgTint: "bg-violet-50 text-violet-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write"],
    riskLevel: "low",
    rationale: "仅开关型插件：读取/写入 tenant_metadata.plugin_config，无用户数据接触，无额外路由与事件。",
    enabled: (config) => config.markdownRender.enabled,
    setEnabled: (config, value) => ({ ...config, markdownRender: { ...config.markdownRender, enabled: value } }),
    render: (config, onChange, busy) => <MarkdownRenderPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "colorSelection",
    icon: ColorIcon,
    name: "多彩投稿",
    tagline: "Colors",
    description: "自定义投稿背景色与文字色的预设色板",
    detailedDescription:
      "本插件让管理员在管理页配置一组投稿可用的背景色与文字色预设，投稿页与稿件墙在展示稿件时会渲染管理员设定的色彩样式。\n\n" +
      "配置方式：\n" +
      "· 背景色预设：最多 10 个，每个预设包含名称、标识（value）与十六进制颜色（如 #F97316）。\n" +
      "· 文字色预设：最多 10 个，同上。\n" +
      "· 系统已内置 5 个背景色与 4 个文字色作为初始模板，可直接修改或新增。\n" +
      "· 标识（value）用于数据库存储与投稿页匹配，建议保持稳定，不要频繁修改。\n" +
      "\n" +
      "使用流程：\n" +
      "· 作者投稿时可以在稿件编辑区选择一个预设的背景色与文字色。\n" +
      "· 稿件墙展示时会按预设渲染为带色彩块的文字卡片，视觉更醒目。\n" +
      "· 稿件发布到 QQ 空间后，颜色信息会随稿件文本一并保留。\n" +
      "\n" +
      "使用建议：\n" +
      "· 避免使用对比度过低的组合（例如米黄底 + 白色字）以免阅读困难。\n" +
      "· 保持背景色与文字色的组合至少 3 种可用搭配，让作者有选择空间。\n" +
      "· 修改预设后需要重新保存配置才会生效，已发布的稿件不会追溯变更颜色。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "背景色与文字色各支持最多 10 个预设，可按需自定义。",
    accent: "from-pink-500 to-orange-500",
    bgTint: "bg-pink-50 text-pink-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "tenant:data"],
    riskLevel: "medium",
    rationale: "读取/写入 tenant_metadata.plugin_config；开启后投稿页向 tenant:data 提交色彩预设 ID，需防止预设被滥用为恶意内容。",
    enabled: (config) => config.colorSelection.enabled,
    setEnabled: (config, value) => ({ ...config, colorSelection: { ...config.colorSelection, enabled: value } }),
    render: (config, onChange, busy) => <ColorSelectionPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "fontSelection",
    icon: FontIcon,
    name: "字体选择",
    tagline: "Fonts",
    description: "从固定字体库中勾选启用的字体",
    detailedDescription:
      "本插件让管理员从系统内置字体库中勾选启用的字体，投稿页会在作者提交稿件时展示对应字体选项，稿件墙与 QQ 空间发布后保留所选字体样式。\n\n" +
      "字体库说明：\n" +
      "· 系统固定字体库共 13 款，均由服务端随镜像一起加载，不需要额外部署。\n" +
      "· 默认字体（value=default）使用浏览器系统字体，永远可用；管理员也可在面板中将其关闭，届时投稿页只显示其余字体。\n" +
      "· 可选中文字体包括：甲骨文字体、承明手写体、寒蝉活楷体、礼品会自由落体、逸善碑篆体、Cascadia Next 简体、寒蝉半圆体、鸿蒙 Sans SC Medium、临海隶书、纳米点宋、思源圆体、舟字宋体。\n\n" +
      "配置方式：\n" +
      "· 在下方「可用字体」列表中逐个勾选/取消勾选，控制投稿页可见字体集合。\n" +
      "· 至少保留 1 款字体启用；投稿页若发现白名单为空会提示「管理员尚未启用任何字体」并隐藏选项。\n\n" +
      "使用流程：\n" +
      "· 作者投稿时点击「字体」按钮可在已启用的字体之间切换；同一稿件可反复切换直到提交。\n" +
      "· 稿件墙与已发布稿件会使用投稿时选择的字体进行渲染。\n" +
      "· 未开启字体选择插件的租户，投稿页不会出现字体按钮。\n\n" +
      "使用建议：\n" +
      "· 校园场景建议至少启用 3 款中文字体，兼顾可读性与个性化。\n" +
      "· 修改字体白名单不会追溯已发布稿件；已发布稿件仍使用投稿时选择的字体。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "系统固定字体库，勾选后投稿页自动展示选项。",
    accent: "from-emerald-500 to-teal-500",
    bgTint: "bg-emerald-50 text-emerald-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "tenant:data"],
    riskLevel: "low",
    rationale: "读取/写入 tenant_metadata.plugin_config；仅开放字体白名单，不引入外部字体源。",
    enabled: (config) => config.fontSelection.enabled,
    setEnabled: (config, value) => ({ ...config, fontSelection: { ...config.fontSelection, enabled: value } }),
    render: (config, onChange, busy) => <FontSelectionPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "anonymousAvatar",
    icon: AnonymousAvatarIcon,
    name: "匿名头像",
    tagline: "Avatars",
    description: "自定义匿名投稿使用的 SVG 头像池",
    detailedDescription:
      "本插件让管理员配置一组匿名投稿使用的 SVG 头像池，作者在投稿时勾选匿名后，稿件会自动从池中随机选取一个头像展示，替代真实 QQ 头像。\n\n" +
      "配置方式：\n" +
      "· 头像池上限 20 个，可无限次增删。\n" +
      "· 内置库：系统预置约 26 款 SVG 头像（如「开心」「可爱的猫」「熊猫吃惊」「头像-男学生1」等），可在面板中一键添加。\n" +
      "· 自定义头像：粘贴以 <svg 开头的完整 SVG 源码即可加入头像池，大小上限 60KB。\n" +
      "· 内置头像支持在卡片中直接切换为另一个内置头像。\n" +
      "· 头像在稿件墙展示时按顺序轮播，随机但不重复。\n\n" +
      "使用流程：\n" +
      "· 开启插件后，投稿页在匿名开关打开时会自动展示当前分配到的头像预览。\n" +
      "· 管理员调整头像池后，下一次匿名投稿会基于新池重新分配。\n" +
      "· 匿名头像会随稿件内容一起发布到 QQ 空间，替代作者的 QQ 头像。\n\n" +
      "使用建议：\n" +
      "· 头像池中至少保留 3 个不同风格头像，避免同一头像高频重复出现。\n" +
      "· 自定义 SVG 建议保持简单清晰，过大或含外链资源的 SVG 会加载缓慢或被浏览器限制。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "最多 20 个头像，可无限修改。",
    accent: "from-sky-500 to-cyan-500",
    bgTint: "bg-sky-50 text-sky-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "user:data", "tenant:data"],
    riskLevel: "medium",
    rationale: "读取/写入 tenant_metadata.plugin_config；头像与匿名稿件绑定后进入稿件渲染，需访问投稿者匿名身份与 tenant 稿件数据。",
    enabled: (config) => config.anonymousAvatar.enabled,
    setEnabled: (config, value) => ({ ...config, anonymousAvatar: { ...config.anonymousAvatar, enabled: value } }),
    render: (config, onChange, busy) => <AnonymousAvatarPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "botStylishMessages",
    icon: BotIcon,
    name: "Bot 多彩消息",
    tagline: "Bot",
    description: "自定义机器人反馈消息的多彩语句",
    detailedDescription:
      "本插件让管理员自定义机器人反馈消息的语句，让投稿成功、审核通过/拒绝、稿件撤回、发布成功等场景下的反馈更生动，避免千篇一律的机器人回复。消息通过 QQ 空间 API 由墙号机器人发送，与稿件事件实时联动。\n\n" +
      "消息类型：\n" +
      "· 投稿成功（submissionSuccess）：作者提交稿件后机器人私聊作者的确认语句。\n" +
      "· 审核通过（reviewApproved）：稿件通过审核后机器人私聊作者的通过通知。\n" +
      "· 审核拒绝（reviewRejected）：稿件被拒绝后机器人私聊作者，并告知拒绝原因。\n" +
      "· 撤回成功（recallSuccess）：作者撤回稿件后机器人发送的撤回确认。\n" +
      "· 发布成功（publishSuccess）：稿件发布到 QQ 空间后机器人通知作者的最终确认。\n\n" +
      "占位符说明：\n" +
      "· {id} — 稿件编号（例如 #1234），投稿成功/审核通过/审核拒绝/撤回成功/发布成功全部支持。\n" +
      "· {reason} — 拒绝原因，仅审核拒绝支持。\n" +
      "· {target} — 稿件标题或摘要片段，所有类型可用。\n" +
      "· {externalId} — QQ 空间发布后的外部 ID，仅发布成功支持。\n" +
      "· 每种消息类型最多配置 10 条语句，发送时随机选择一条，同一稿件不会连发两条不同语句。\n\n" +
      "使用流程：\n" +
      "· 在下方「消息类型」列表中打开或关闭每种类型的自定义语句开关；关闭后回退到系统默认简洁消息。\n" +
      "· 单条语句可通过输入框编辑，也可点击「删除」移除；不足 10 条时可点击「新增语句」继续添加。\n" +
      "· 保存配置后，下一次触发对应事件时机器人会立即使用新语句。\n\n" +
      "使用建议：\n" +
      "· 语句保持简短友好，单条建议不超过 40 个汉字；过长会被 QQ 空间消息长度限制截断。\n" +
      "· 避免在语句中包含敏感词、夸大表述或暗示平台身份的信息；插件仅改写文本，不做合规审核。\n" +
      "· 若希望某些消息类型保持默认简洁风格，直接关闭对应开关即可，不影响其他类型。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "每种消息类型最多 10 条自定义语句，支持占位符。",
    accent: "from-amber-500 to-rose-500",
    bgTint: "bg-amber-50 text-amber-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "events:listen", "tenant:data"],
    riskLevel: "medium",
    rationale: "读取/写入 tenant_metadata.plugin_config；监听投稿/审核/发布事件后改写机器人提示语句，需避免语句中包含敏感或误导信息。",
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

// 后端对新租户返回的 fontSelection.fonts 默认为 []，若不补齐，字体面板会空白无字体可勾。
// 这里按 FONT_OPTIONS 顺序铺满；已有项保留原 enabled 值，避免覆盖管理员的选择。
function ensureFontSelectionDefaults(config: TenantPluginConfig): TenantPluginConfig {
  const existing = new Map(config.fontSelection.fonts.map((item) => [item.value, item]));
  const fonts = FONT_OPTIONS.map((entry) => ({
    value: entry.value,
    enabled: existing.get(entry.value)?.enabled ?? entry.value === "default",
  }));
  return { ...config, fontSelection: { ...config.fontSelection, fonts } };
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
      items: builtInSvgAvatarFilenames.slice(0, 10).map((filename) => ({ id: filename })),
    },
    botStylishMessages: {
      enabled: metadata.botStylishMessagesEnabled ?? false,
      messageTypes: [],
    },
  };
}

export function PluginConfigPage({ tenantId, metadata, onSaved }: { tenantId: string; metadata: TenantMetadata; onSaved?: () => void | Promise<void> }) {
  const [config, setConfig] = useState<TenantPluginConfig>(() => ensureFontSelectionDefaults(ensureBotMessageDefaults(buildInitialConfig(metadata))));
  const [activeId, setActiveId] = useState<PluginId>("markdownRender");
  const [showPluginInfo, setShowPluginInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // 预设插件启用集合：来自 /api/admin/plugins 的 registry status。
  // 侧栏只展示在插件注册表中已启用的预设插件，与「管理-插件」页保持一致。
  const [enabledPresetNames, setEnabledPresetNames] = useState<Set<string>>(new Set());
  // 侧栏插件列表可折叠；默认展开。
  const [showSidebarPlugins, setShowSidebarPlugins] = useState(true);


  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ config: TenantPluginConfig }>("/api/admin/plugins/settings")
      .then((data) => {
        if (!cancelled) setConfig(ensureFontSelectionDefaults(ensureBotMessageDefaults(data.config)));
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "读取插件配置失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    api<{ plugins: Array<{ name: string; status: "enabled" | "disabled" }> }>("/api/admin/plugins")
      .then((data) => {
        if (cancelled) return;
        setEnabledPresetNames(new Set(data.plugins.filter((p) => p.status === "enabled").map((p) => p.name)));
      })
      .catch(() => { /* 读取失败时保持空集合，避免误显示 */ });
    return () => { cancelled = true; };
  }, [tenantId]);
  // 保存后 registry 状态可能变化，拉取一次保持侧栏同步
  async function refreshEnabledPlugins() {
    if (!tenantId) return;
    try {
      const data = await api<{ plugins: Array<{ name: string; status: "enabled" | "disabled" }> }>("/api/admin/plugins");
      setEnabledPresetNames(new Set(data.plugins.filter((p) => p.status === "enabled").map((p) => p.name)));
    } catch {
      // 静默失败；下一次拉取会重新同步。
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/plugins/settings", { method: "PATCH", body: JSON.stringify(config) });
      toast.success("插件配置已保存");
      await onSaved?.();
      // 插件启用状态可能因为保存而变，重新拉一次列表保持侧栏同步
      void refreshEnabledPlugins();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "插件配置保存失败");
    } finally {
      setBusy(false);
    }
  }

  // 侧栏只展示在插件注册表中已启用的预设插件。
  // 用户需在「管理-插件」页启用后才会出现此处。
  const enabledPlugins = PLUGINS.filter((plugin) => enabledPresetNames.has(PRESET_NAME_BY_ID[plugin.id]));

  // 若当前选中的插件已被禁用，自动跳到第一个已启用的插件。
  useEffect(() => {
    if (enabledPlugins.length === 0) return;
    if (!enabledPlugins.some((plugin) => plugin.id === activeId)) {
      setActiveId(enabledPlugins[0]!.id);
    }
  }, [enabledPlugins, activeId]);

  const active = enabledPlugins.find((plugin) => plugin.id === activeId) ?? enabledPlugins[0];
  const ActiveIcon = active?.icon;

  return (
    <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      <Card className="rounded-md border-slate-200 bg-white shadow-none">
        <CardContent className="flex h-full flex-col p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md bg-slate-50 ring-1 ring-slate-200"><PluginConfigIcon className="size-6" /></span>
              <div>
                <p className="text-sm font-semibold text-slate-900">插件配置</p>
                <p className="text-xs text-slate-500">已启用 {enabledPlugins.length} 个</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setShowSidebarPlugins((value) => !value)}
                title={showSidebarPlugins ? "收起插件列表" : "展开插件列表"}
              >
                {showSidebarPlugins ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-1 overflow-y-auto">
            {showSidebarPlugins ? (
              enabledPlugins.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-400">
                  <p>暂无已启用的插件</p>
                  <p className="mt-1">请到「插件」子页启用预设插件</p>
                </div>
              ) : (
                enabledPlugins.map((plugin) => {
                  const isActive = plugin.id === activeId;
                  return (
                    <div key={plugin.id} className="group">
                      <button type="button" onClick={() => setActiveId(plugin.id)} className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-slate-50" data-active={isActive || undefined}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-gradient-to-br text-white" style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}><plugin.icon className="size-5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{plugin.name}</p>
                          <p className="truncate text-xs text-slate-500">{plugin.tagline}</p>
                        </div>
                      </button>
                    </div>
                  );
                })
              )
            ) : null}
          </div>
          <div className="mt-3 border-t border-slate-200 pt-3">
            <Button className="w-full" disabled={busy || loading || enabledPlugins.length === 0} onClick={() => void save()}><SaveIcon className="size-4" />{busy ? "保存中…" : "保存配置"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-md border-slate-200 bg-white shadow-none">
        <CardContent className="flex h-full flex-col p-4">
          {loading ? (
            <div className="grid flex-1 place-items-center text-sm text-slate-500"><LoaderIcon className="size-5 animate-spin" /> 加载插件配置中…</div>
          ) : (
            enabledPlugins.length === 0 ? (
              <div className="grid flex-1 place-items-center">
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  <p className="font-semibold text-slate-700">尚未启用任何预设插件</p>
                  <p className="mt-1 text-xs">请在「插件」子页启用预设插件后，回来配置。</p>
                </div>
              </div>
            ) : (
            <div className="flex-1 space-y-4 overflow-y-auto">
              <div className="flex items-center gap-3">
                {ActiveIcon ? <span className="grid size-12 place-items-center rounded-md bg-gradient-to-br text-white" style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}><ActiveIcon className="size-6" /></span> : null}
                <div className="flex-1">
                  <p className="text-base font-semibold text-slate-900">{active?.name}</p>
                  <p className="text-xs text-slate-500">{active?.description}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400"><UserIcon className="size-3" />作者：{active?.author}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={busy || !active} onClick={() => setShowPluginInfo(true)} title="查看当前插件详细说明"><InfoIcon className="size-4" />说明</Button>
                </div>
              </div>
              {active?.render(config, setConfig, busy)}
            </div>
          ))}
        </CardContent>
      </Card>

      <PluginInfoDialog
        open={showPluginInfo}
        onOpenChange={(open) => setShowPluginInfo(open)}
        plugin={active}
      />
    </div>
  );
}

function PluginInfoDialog({
  open,
  onOpenChange,
  plugin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: PluginDescriptor | undefined;
}) {
  if (!plugin) return null;
  const Icon = plugin.icon;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-10">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gradient-to-br text-white" style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}>
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{plugin.name}</DialogTitle>
              <DialogDescription className="mt-0.5 inline-flex items-center gap-1 text-xs">
                <UserIcon className="size-3" />
                作者：{plugin.author}
                <span className="mx-1 text-slate-300">·</span>
                {plugin.tagline}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-3 px-5 pb-5 text-sm leading-6 text-slate-700">
          <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-6 text-slate-600">
            {plugin.detailedDescription}
          </p>
          <div>
            <p className="text-xs font-medium text-slate-500">使用建议</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{plugin.hint}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">风险声明</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{plugin.rationale}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">所需权限</p>
            <div className="mt-2">
              <PermissionBadge permissions={plugin.required} risk={plugin.riskLevel} rationale={plugin.rationale} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

