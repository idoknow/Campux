import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, FileTextIcon, KeyRoundIcon, LoaderIcon, PowerIcon, SaveIcon, ShieldCheckIcon, ShieldIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import { FONT_OPTIONS } from "@campux/domain";
import type { AdminMember, BotMessageTypeConfig, PluginBroadcastPreset, PluginColorPreset, TenantMetadata, TenantPluginConfig, TenantRole } from "@/types/app";
import { api } from "@/lib/api";
import { builtInSvgAvatarFilenames } from "@/lib/built-in-svg-avatars";
import { filterPluginAuditLogs } from "./plugin-audit-log-filter";
import { AggregateLoginIcon, AggregateLoginPluginIcon, AGGREGATE_LOGIN_TYPE_LABELS } from "../aggregate-oauth/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { roleLabels } from "@/lib/app-model";
import { BroadcastIcon } from "../broadcast/BroadcastIcon";
import { GraduationIcon } from "../graduation/GraduationIcon";

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
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none">
      <path d="M512 1024C76.96384 1024 0 947.03616 0 512S76.96384 0 512 0 1024 76.96384 1024 512 947.022507 1024 512 1024z m0-998.4C98.727253 25.6 25.6 98.7136 25.6 512S98.727253 998.4 512 998.4 998.4 925.272747 998.4 512 925.272747 25.6 512 25.6z" fill="#EAC1B2" /><path d="M279.893333 785.066667c-101.034667 0-177.793707-5.270187-236.05248-21.149014C30.26944 698.69568 25.6 616.174933 25.6 512 25.6 98.7136 98.727253 25.6 512 25.6c31.402667 0 60.648107 0.49152 88.255147 1.460907C671.45728 83.367253 689.493333 187.665067 689.493333 375.466667c0 348.023467-61.576533 409.6-409.6 409.6z" fill="#EAC1B2" opacity=".2" /><path d="M339.503787 523.946667l228.816213-228.816214 228.816213 228.816214-228.816213 228.816213z" fill="#EAC1B2" /><path d="M802.051413 515.39968L702.99648 614.4H669.013333l109.226667-109.226667s-40.004267-40.809813-54.613333-54.613333c-5.36576-5.065387 10.07616 97.348267-81.92 109.226667-50.039467 6.458027-94.631253-40.1408-95.573334-95.573334-1.14688-67.078827 89.675093-88.255147 81.92-95.573333-41.1648-38.87104-95.573333-95.573333-95.573333-95.573333l-114.688 114.688-47.295147-47.295147a50.83136 50.83136 0 1 0-9.557333 9.775787L408.234667 397.312 286.72 518.826667l144.46592 136.43776-45.970773 45.970773a50.817707 50.817707 0 1 0 9.325226 9.885013s0.12288 0 0.177494-0.068266l46.421333-46.421334L532.48 750.933333l54.613333-54.613333v33.901227l-57.234773 57.207466-89.361067-89.347413A15.837867 15.837867 0 0 0 413.696 712.430933c0 0.314027 0.150187 0.505173 0.150187 0.846507a8.096427 8.096427 0 0 0 1.365333 3.39968 68.840107 68.840107 0 1 1-40.96-41.301333 10.77248 10.77248 0 0 0 2.280107 0.887466A15.824213 15.824213 0 0 0 392.260267 649.898667l-134.51264-134.43072 114.128213-114.059947a15.824213 15.824213 0 0 0-14.363307-26.78784c-0.354987 0-0.505173 0.191147-0.846506 0.191147a8.192 8.192 0 0 0-3.44064 1.365333 68.758187 68.758187 0 1 1 41.314986-40.96 15.837867 15.837867 0 0 0 25.613654 17.98144l115.862186-115.780267 140.16512 140.0832a16.124587 16.124587 0 0 1 0 22.459734 15.824213 15.824213 0 0 1-15.674026 3.97312 7.195307 7.195307 0 0 1-2.321067-0.887467 68.56704 68.56704 0 0 0-72.594773 15.906133 68.717227 68.717227 0 1 0 113.568426 25.408854 9.038507 9.038507 0 0 1-1.365333-3.44064c0-0.354987-0.2048-0.546133-0.2048-0.846507a15.7696 15.7696 0 0 1 4.328107-14.363307 14.7456 14.7456 0 0 1 6.567253-3.822933 15.332693 15.332693 0 0 1 15.906133 3.822933l83.694934 83.64032zM638.64832 655.36h116.61312a10.60864 10.60864 0 1 1 0 21.203627h-116.61312a10.60864 10.60864 0 1 1 0-21.203627z m0 42.407253h95.409493a10.594987 10.594987 0 1 1 0 21.203627h-95.409493a10.594987 10.594987 0 1 1 0-21.203627z m0 42.407254h84.814507a10.60864 10.60864 0 1 1 0 21.203626h-84.814507a10.60864 10.60864 0 1 1 0-21.203626z" fill="#9B3A18" />
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

export function CampaignsIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <path d="M5.9 520h50l43.7 62.2h-50z" fill="#FD643A" />
      <path d="M1009.7 357.9l8.4 24.9-26.9 22.9-8.3-24.9z" fill="#FD9E1C" />
      <path d="M860.2 954.1H70.6c-23.6 0-42.7-19.1-42.7-42.7l64-170.7c0-23.6 19.1-42.7 42.7-42.7h682.9c23.6 0 42.7 19.1 42.7 42.7l42.7 170.7c0 23.6-19.1 42.7-42.7 42.7z" fill="#90C261" />
      <path d="M694.9 854.7H250.2c-11.9 0-21.5-9.6-21.5-21.5s9.6-21.5 21.5-21.5h444.7c11.9 0 21.5 9.6 21.5 21.5s-9.6 21.5-21.5 21.5z" fill="#FFFFFF" />
      <path d="M830 514L576.4 767.5c-56 56-146.8 56-202.9 0l-164-164.1c-56-56-56-146.8 0-202.9L463.1 147c56-56 146.8-56 202.9 0l164 164.1c56 56 56 146.8 0 202.9z" fill="#FD7D24" />
      <path d="M768.5 487.1L545.3 710.2c-42 42-110.1 42-152.1 0L267.1 584.1c-42-42-42-110.1 0-152.1l223.1-223.1c42-42 110.1-42 152.1 0L768.4 335c42.1 41.9 42.1 110.1 0.1 152.1z" fill="#FFCA28" />
      <path d="M780 638h26.2l13.1 32.7h-26.2z" fill="#FD9E1C" />
      <path d="M530.7 548.6l-118-108.4c-7.2-7.2-19-7.2-26.2 0-7.2 7.2-7.2 18.8 0 26l104.8 121.4c7.2 7.2 23.3 2.8 30.6-4.3 7.3-7.2 16-27.6 8.8-34.7z" fill="#FFFFFF" />
      <path d="M696.6 375.1c-7.2-7.2-19-7.2-26.2 0L478.2 548.6c-7.2 7.2-2.9 23.2 4.4 30.4 7.2 7.2 27.7 15.9 34.9 8.7l179.1-186.4c7.3-7.3 7.3-19 0-26.2z" fill="#FFFFFF" />
    </svg>
  );
}

type PluginId = "markdownRender" | "colorSelection" | "fontSelection" | "anonymousAvatar" | "botStylishMessages" | "campaigns" | "aggregateLogin" | "broadcast" | "feedback" | "botAlert" | "graduation" | "todayInHistory";
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
  campaigns: "campux-plugin-campaigns",
  aggregateLogin: "campux-plugin-aggregate-login",
  broadcast: "campux-plugin-broadcast",
  feedback: "campux-plugin-feedback",
  botAlert: "campux-plugin-bot-alert",
  graduation: "campux-plugin-graduation",
  todayInHistory: "campux-plugin-today-in-history",
};

// 侧栏只展示预设插件；已启用计数与条目高亮也只统计预设插件的 registry 状态。
// /api/admin/plugins 返回的第三方 registry 插件不参与预设插件的显示。
const PRESET_REGISTRY_NAMES = new Set(Object.values(PRESET_NAME_BY_ID));

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

function BotAlertIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none">
      <path d="M313.2416 0H716.8a307.2 307.2 0 0 1 307.2 307.2v198.0928A484.2496 484.2496 0 0 1 793.6 563.2 486.4 486.4 0 0 1 313.2416 0z" fill="#20C997" />
      <path d="M909.824 785.5104a51.2 51.2 0 1 1 95.5904 36.7616A307.3024 307.3024 0 0 1 716.8 1024H307.2a307.2 307.2 0 0 1-307.2-307.2V307.2a307.2 307.2 0 0 1 307.2-307.2h409.6a307.2 307.2 0 0 1 307.2 307.2v204.8a51.2 51.2 0 0 1-102.4 0V307.2a204.8 204.8 0 0 0-204.8-204.8H307.2a204.8 204.8 0 0 0-204.8 204.8v409.6a204.8 204.8 0 0 0 204.8 204.8h409.6a204.9024 204.9024 0 0 0 193.024-136.0896zM299.1104 628.1728l-54.528 67.328a51.2 51.2 0 1 1-79.5648-64.4608l88.832-109.6704a51.2 51.2 0 0 1 74.4448-5.4784l60.416 55.5008L478.208 291.584c14.592-45.5168 78.0288-48.0256 96.1536-3.7888l132.3008 323.1744 69.632-88.9344a51.2 51.2 0 0 1 80.64 63.1296l-124.0064 158.3104a51.2 51.2 0 0 1-87.6544-12.1856L532.8896 456.704 461.824 678.8608a51.2 51.2 0 0 1-83.4048 22.1184l-79.2576-72.8064z" fill="#2C6DD2" />
    </svg>
  );
}

function FeedbackIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1126 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className} fill="none">
      <path d="M652.98432 827.2896c-15.72352 26.19392-26.20416 52.38784-26.20416 83.83488 0 10.49088 10.48064 20.9664 20.9664 20.9664h5.23776c31.4368 0 57.64096-10.47552 78.60736-26.19392l141.47584-151.97184-83.83488-73.35936-136.24832 146.72384z m282.96704-204.36992l-20.9664-20.95104c-15.71328-15.7184-41.92256-15.7184-57.64096 0l-26.20416 26.1888 83.84512 73.3696 20.9664-20.9664c20.95616-15.71328 20.95616-41.91744 0-57.64096z m-89.08288-162.43712V198.4768c0-26.19904-5.23776-52.39808-26.20416-73.35936-20.96128-15.7184-52.39808-31.4368-78.60224-31.4368H270.45376c-31.4368 0-57.64096 15.7184-78.59712 31.4368-15.72352 20.96128-26.20416 47.16032-26.20416 73.35936v576.41984c0 57.63584 47.16032 104.78592 104.80128 104.78592h209.60256c26.20416 0 52.39808-36.66432 68.12672-57.63072l272.48128-293.44256c20.9664-15.72352 26.20416-41.92256 26.20416-68.12672z m-314.40896 261.99552H270.45376v-52.39296h262.00064v52.39296z m104.80128-209.59232H270.45376V460.48256h366.80704v52.4032z m104.8064-209.60256H270.45376V250.88512h471.60832v52.39808z m0 0" fill="#98CA6B" />
    </svg>
  );
}

function FeedbackPanel() {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        开启后，投稿页最上方会出现「意见反馈」入口。意见会先保存；墙号在线且已开启审核群通知时会同步到审核群，否则仅保存并提示通知失败。
      </div>
    </div>
  );
}

function BotAlertPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  const alert = config.botAlert;
  const [portText, setPortText] = useState(String(alert.smtpPort));
  // 收件邮箱行使用稳定 id 作为 React key：编辑/删除行时焦点元素不会被复用到别的收件人上。
  const rowIdRef = useRef(0);
  const nextRowId = () => ++rowIdRef.current;
  const [emailRows, setEmailRows] = useState(() => alert.toEmails.map((value) => ({ id: nextRowId(), value })));
  // 本面板最近写出的 toEmails（JSON 快照）：区分「自己输入引发的 props 变化」与「外部刷新」
  //（保存清理、重新拉取配置），只有后者才重建行列表。
  const pushedEmailsRef = useRef<string | null>(null);
  useEffect(() => {
    const incoming = JSON.stringify(alert.toEmails);
    if (pushedEmailsRef.current !== incoming) {
      setEmailRows(alert.toEmails.map((value) => ({ id: nextRowId(), value })));
    }
  }, [alert.toEmails]);
  const set = (patch: Partial<TenantPluginConfig["botAlert"]>) => {
    onChange({ ...config, botAlert: { ...alert, ...patch } });
  };
  const updateEmailRows = (rows: Array<{ id: number; value: string }>) => {
    setEmailRows(rows);
    const values = rows.map((row) => row.value);
    pushedEmailsRef.current = JSON.stringify(values);
    set({ toEmails: values });
  };
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        开启后，当 QZone 登录态失效且自动刷新失败时，向收件邮箱发送异常通知。请先配置 SMTP 服务器与收件邮箱；
        保存设置前会先发送测试邮件，测试通过后才会保存。
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          SMTP 服务器
          <Input value={alert.smtpHost} disabled={busy} placeholder="smtp.example.com" onChange={(e) => set({ smtpHost: e.target.value })} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          SMTP 端口
          <Input type="number" value={portText} disabled={busy} onChange={(e) => setPortText(e.target.value)} onBlur={() => set({ smtpPort: Number(portText) || 465 })} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          发件邮箱
          <Input value={alert.fromEmail} disabled={busy} placeholder="bot@example.com" onChange={(e) => set({ fromEmail: e.target.value })} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          邮箱账号
          <Input value={alert.smtpUser} disabled={busy} onChange={(e) => set({ smtpUser: e.target.value })} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          邮箱密码/授权码
          <Input type="password" value={alert.smtpPass} disabled={busy} onChange={(e) => set({ smtpPass: e.target.value })} />
        </label>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">收件邮箱</p>
            <Button size="sm" variant="outline" disabled={busy || emailRows.length >= 20} onClick={() => updateEmailRows([...emailRows, { id: nextRowId(), value: "" }])}>
              + 新增收件邮箱（{emailRows.length}/20）
            </Button>
          </div>
          {emailRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
              暂未配置收件邮箱，点击「新增收件邮箱」逐个添加。
            </div>
          ) : (
            <div className="grid gap-2">
              {emailRows.map((row, index) => (
                <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Input
                    value={row.value}
                    placeholder={`收件邮箱 ${index + 1}`}
                    disabled={busy}
                    onChange={(e) => updateEmailRows(emailRows.map((item) => (item.id === row.id ? { ...item, value: e.target.value } : item)))}
                  />
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => updateEmailRows(emailRows.filter((item) => item.id !== row.id))}>删除</Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !alert.smtpHost || !alert.smtpUser || !alert.smtpPass || !alert.fromEmail || emailRows.length === 0}
            onClick={async () => {
              // 与保存门禁一致：先丢弃空行，再拿清理后的列表发测试邮件。
              const cleaned = emailRows.map((row) => row.value.trim()).filter(Boolean);
              if (cleaned.length === 0) {
                toast.error("请先填写至少一个收件邮箱");
                return;
              }
              try {
                const res = await api<{ ok: boolean; message: string }>("/api/admin/plugins/bot-alert/test", {
                  method: "POST",
                  body: JSON.stringify({
                    smtpHost: alert.smtpHost,
                    smtpPort: alert.smtpPort,
                    smtpUser: alert.smtpUser,
                    smtpPass: alert.smtpPass,
                    fromEmail: alert.fromEmail,
                    toEmails: cleaned,
                  }),
                });
                toast.success(res.message || "测试邮件已发送");
              } catch (caught) {
                toast.error(caught instanceof Error ? caught.message : "测试发送失败");
              }
            }}
          >
            发送测试邮件
          </Button>
          <span className="text-xs text-slate-400">发送一封标题为「测试」的邮件验证配置</span>
        </div>
      </div>
    </div>
  );
}

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

function CampaignsPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  const setMaxActive = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    // 名额下限 1（保证已发布的竞选仍可重新发起），上限与后端 zod 一致。
    const next = Number.isFinite(parsed) ? Math.max(1, Math.min(50, parsed)) : 1;
    onChange({ ...config, campaigns: { ...config.campaigns, maxActivePerUser: next } });
  };

  return (
    <div className="space-y-4">
      <SwitchField
        title="允许匿名发起"
        description="开启后，发起竞选时可选择匿名（展示内容不包含发起人身份）。"
        checked={config.campaigns.allowAnonymousCreate}
        disabled={busy}
        onChange={(value) => onChange({ ...config, campaigns: { ...config.campaigns, allowAnonymousCreate: value } })}
      />
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900">每个用户最多同时进行的竞选</p>
            <p className="text-xs leading-5 text-slate-500">统计「待审核 + 进行中」的竞选；已结束、已拒绝、已下架不占名额。默认 1。</p>
          </div>
          <Input
            type="number"
            min={1}
            max={50}
            value={config.campaigns.maxActivePerUser}
            disabled={busy}
            onChange={(event) => setMaxActive(event.target.value)}
            className="w-20 text-right"
          />
        </div>
      </div>
    </div>
  );
}

const AGGREGATE_LOGIN_ORDER: Array<keyof typeof AGGREGATE_LOGIN_TYPE_LABELS> = [
  "qq",
  "wx",
  "alipay",
  "douyin",
  "sina",
  "baidu",
  "huawei",
  "xiaomi",
  "gitee",
  "gitea",
  "bilibili",
  "kuaishou",
];

function AggregateLoginPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  const toggleType = (type: string) => {
    const has = config.aggregateLogin.loginTypes.includes(type);
    const next = has
      ? config.aggregateLogin.loginTypes.filter((item) => item !== type)
      : [...config.aggregateLogin.loginTypes, type];
    onChange({ ...config, aggregateLogin: { ...config.aggregateLogin, loginTypes: next } });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-slate-500">
        开启后，登录页会展示下方勾选的第三方登录方式。用户需先在账号设置里绑定第三方身份，之后即可用该身份直接登录本校园墙；未绑定的身份不会自动建号。
      </p>
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="mb-2 text-sm font-medium text-slate-900">可登录方式</p>
        <div className="flex flex-wrap gap-2">
          {AGGREGATE_LOGIN_ORDER.map((type) => {
            const selected = config.aggregateLogin.loginTypes.includes(type);
            const Icon = AggregateLoginIcon;
            return (
              <button
                key={type}
                type="button"
                disabled={busy}
                onClick={() => toggleType(type)}
                aria-pressed={selected}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className="h-3.5 w-3.5">
                  <Icon type={type} className="h-full w-full" />
                </span>
                {AGGREGATE_LOGIN_TYPE_LABELS[type] ?? type}
              </button>
            );
          })}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="mb-2 space-y-1">
          <p className="text-sm font-medium text-slate-900">聚合登录凭证</p>
          <p className="text-xs leading-5 text-slate-500">在任意一家聚合登录平台申请并配置（appid / appkey / 接口地址）。</p>
        </div>
        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs text-slate-500">AppID</span>
            <Input
              value={config.aggregateLogin.appId}
              disabled={busy}
              placeholder="申请到的 AppID"
              onChange={(event) => onChange({ ...config, aggregateLogin: { ...config.aggregateLogin, appId: event.target.value } })}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-slate-500">AppKey</span>
            <Input
              type="password"
              value={config.aggregateLogin.appKey}
              disabled={busy}
              placeholder="申请到的 AppKey"
              onChange={(event) => onChange({ ...config, aggregateLogin: { ...config.aggregateLogin, appKey: event.target.value } })}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-slate-500">接口地址</span>
            <Input
              value={config.aggregateLogin.endpoint}
              disabled={busy}
              placeholder="https://…/connect.php"
              onChange={(event) => onChange({ ...config, aggregateLogin: { ...config.aggregateLogin, endpoint: event.target.value } })}
            />
          </label>
        </div>
      </div>
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


// 与后端 tenantPluginConfigSchema 的 BROADCAST_PRESET_MAX_COUNT 保持一致。
const BROADCAST_PRESET_MAX = 5;

function BroadcastPresetEditor({ values, disabled, onChange }: { values: PluginBroadcastPreset[]; disabled?: boolean; onChange: (next: PluginBroadcastPreset[]) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">快选生效时长</p>
          <p className="text-xs text-slate-500">发帖人点一下即按当前时刻推算结束时间（最多 5 个）。</p>
        </div>
        <Button size="sm" variant="outline" disabled={disabled || values.length >= BROADCAST_PRESET_MAX} onClick={() => onChange([...values, { label: "", minutes: 60 }])}>
          + 新增预设
        </Button>
      </div>
      {values.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
          暂未配置，发帖人只能手动选择日期与时间。
        </div>
      ) : (
        <div className="grid gap-2">
          {values.map((preset, index) => (
            <div key={index} className="grid grid-cols-[1fr_112px_40px] items-center gap-2 rounded-md border border-slate-200 bg-white p-2">
              <Input value={preset.label} placeholder="名称，如「半小时内」" disabled={disabled} onChange={(event) => onChange(values.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item)))} />
              <div className="flex items-center gap-1">
                <Input type="number" min={1} max={10080} value={preset.minutes} disabled={disabled} onChange={(event) => onChange(values.map((item, itemIndex) => (itemIndex === index ? { ...item, minutes: Number(event.target.value) } : item)))} />
                <span className="text-xs text-slate-400">分钟</span>
              </div>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BroadcastPanel({ config, onChange, busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  const setBroadcast = (patch: Partial<TenantPluginConfig["broadcast"]>) => {
    onChange({ ...config, broadcast: { ...config.broadcast, ...patch } });
  };
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        开启后，投稿页顶部会多出「广播通知」胶囊，服务页出现广播通知入口。
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <BroadcastPresetEditor
          values={config.broadcast.quickPresets}
          disabled={busy}
          onChange={(quickPresets) => setBroadcast({ quickPresets })}
        />
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
        通知内容在投稿页填写，时效结束时间最长 7 天；
        「已广播」与「违规删除」按钮由管理员在用户管理中授予「广播员」身份的用户使用。
      </div>
    </div>
  );
}

function TodayInHistoryIcon({ className }: PluginIconProps) {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <path d="M511.512381 521.264762m-458.849524 0a458.849524 458.849524 0 1 0 917.699048 0 458.849524 458.849524 0 1 0-917.699048 0Z" fill="#FF7396" />
      <path d="M511.512381 521.264762m-291.596191 0a291.59619 291.59619 0 1 0 583.192381 0 291.59619 291.59619 0 1 0-583.192381 0Z" fill="#FFC800" />
      <path d="M511.512381 278.430476c134.095238 0 242.834286 108.739048 242.834286 242.834286s-108.739048 242.834286-242.834286 242.834286-242.834286-108.739048-242.834286-242.834286c0-134.095238 108.739048-242.834286 242.834286-242.834286m0-48.761905c-160.914286 0-291.59619 130.681905-291.596191 291.596191s130.681905 291.59619 291.596191 291.59619 291.59619-130.681905 291.59619-291.59619-130.681905-291.59619-291.59619-291.596191z" fill="#D84475" />
      <path d="M320.365714 487.619048c-1.950476 0-3.900952-0.487619-5.851428-0.975238-10.24-2.925714-16.091429-14.140952-13.165715-24.380953 1.462857-3.900952 2.438095-8.289524 3.900953-12.190476 8.289524-23.405714 20.48-45.348571 36.571428-64.853333 6.826667-8.289524 19.017143-9.752381 27.306667-2.925715 8.289524 6.826667 9.752381 19.017143 2.925714 27.306667-13.165714 16.091429-22.918095 34.133333-29.744762 53.150476-0.975238 3.413333-2.438095 6.826667-3.413333 10.24-2.438095 9.264762-10.24 14.628571-18.529524 14.628572zM430.08 360.350476c-7.314286 0-14.628571-4.388571-17.554286-11.215238-4.388571-9.752381-0.487619-21.455238 9.264762-25.843809 8.777143-4.388571 18.041905-7.801905 27.794286-10.727619 10.24-3.413333 21.455238 2.438095 24.380952 12.678095 3.413333 10.24-2.438095 21.455238-12.678095 24.380952-7.801905 2.438095-15.60381 5.36381-22.918095 8.777143-2.925714 1.462857-5.851429 1.950476-8.289524 1.950476z" fill="#FFFFFF" />
      <path d="M511.512381 1004.495238h-2.438095c-129.219048-0.487619-250.148571-51.687619-340.845715-143.36-90.697143-91.672381-140.434286-213.577143-139.946666-342.308571 0-13.653333 11.215238-24.380952 24.380952-24.380953 13.653333 0 24.380952 11.215238 24.380953 24.380953-0.487619 116.053333 43.885714 225.28 125.805714 307.687619s190.659048 128.24381 306.712381 128.731428h2.438095c115.078095 0 223.817143-44.373333 305.737143-125.805714 82.407619-81.432381 128.24381-190.659048 128.731428-306.712381 0.975238-239.420952-192.609524-435.44381-432.518095-436.906667h-2.438095c-110.201905 0-215.527619 41.447619-295.984762 116.540953-10.727619 10.727619-27.794286 12.190476-39.497143 2.438095-7.801905-6.339048-11.702857-16.091429-10.24-26.331429l9.264762-130.681904c0.975238-13.653333 12.678095-23.405714 25.84381-22.430477 13.653333 0.975238 23.405714 12.678095 22.430476 25.84381l-5.851429 85.820952C301.348571 73.142857 404.23619 38.034286 511.512381 38.034286h2.438095c266.24 1.462857 482.255238 219.428571 480.792381 485.668571-0.487619 129.219048-51.687619 250.148571-143.36 340.845714-91.184762 90.209524-211.626667 139.946667-339.870476 139.946667z" fill="#D84475" />
      <path d="M414.47619 599.771429c-7.801905 0-15.11619-3.413333-19.99238-10.24-7.801905-11.215238-4.87619-26.331429 5.851428-34.133334l87.771429-61.44 65.340952-129.706666c5.851429-12.190476 20.48-17.066667 32.670476-10.727619 12.190476 5.851429 17.066667 20.48 10.727619 32.670476l-67.779047 135.070476c-1.950476 3.413333-4.388571 6.826667-7.801905 9.264762l-93.135238 64.853333c-3.900952 2.925714-8.777143 4.388571-13.653334 4.388572z" fill="#D84475" />
    </svg>
  );
}

function TodayInHistoryPanel({ busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  void busy;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        开启后，投稿页顶部会多出「那年今日」胶囊，展示历史上同一月同一日发布的稿件，按年份倒序分组。
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
        数据来自本校园墙的已发布稿件，仅读取不写入；日期按校园墙所在时区（Asia/Shanghai）的日历日判定。
      </div>
    </div>
  );
}

function GraduationPanel({ busy }: { config: TenantPluginConfig; onChange: (next: TenantPluginConfig) => void; busy: boolean }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        开启后，投稿页顶部会多出「毕业去向」胶囊，服务页新增毕业生去向入口（用户/学校/时间/搜索四视图）。
        提交后进入审核队列，审核员可手动通过或驳回。
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
        入学年份（级）与毕业年份（届）均由投稿人在表单里自行填写，本插件无需配置年限换算规则。
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
        审核群命令：#毕业通过 &lt;编号&gt; / #毕业拒绝 &lt;理由&gt; &lt;编号&gt;；网页端在「服务页 → 毕业生去向 → 待审核」处理。
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
  {
    id: "campaigns",
    icon: CampaignsIcon,
    name: "投票竞选",
    tagline: "Campaigns",
    description: "发起投票竞选，审核通过后在服务页公开投票",
    detailedDescription:
      "本插件新增「投票竞选」能力：作者在投稿页顶部的胶囊导航中切换到「投票」发起竞选，管理员/审核员通过审核群指令或网页审核后开始计时，参与者在服务页的投票竞选入口查看与投票。\n\n" +
      "发起参数：\n" +
      "· 标题与可选封面图；配置开启「允许匿名发起」时才展示匿名选项。\n" +
      "· 至少 2 个选项，每个选项可选配图。\n" +
      "· 「每人对每个选项可投多票」关闭时每人 1 票且不展示票数字段；打开后填写每人总票数，可拆到多个选项也可叠在同一选项。\n" +
      "· 竞选时长最短 12 小时、最长 365 天，审核通过后才开始计时。\n" +
      "· 「可见谁投了谁」默认开启；关闭后隐藏每人明细，选项总票数与排名仍展示。\n\n" +
      "审核与通知：\n" +
      "· 竞选使用与稿件分开的独立编号（竞选#N），审核通知发到同一审核群，文案与指令均与稿件区分。\n" +
      "· 审核员可用 #投票通过 <编号> / #投票拒绝 <理由> <编号> 处理；网页端在服务 → 投票竞选 → 审核中操作，拒绝必填理由。\n" +
      "· 通过后私聊发起者并发 QQ 空间；拒绝与下架均私聊告知。\n\n" +
      "管理：\n" +
      "· 下方可配置是否允许匿名发起，以及每个用户最多同时在进行的竞选数（统计待审核 + 进行中）。\n" +
      "· 管理员可随时下架进行中的竞选。插件禁用后入口与页面全部隐藏，进行中的竞选不再接受投票。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "与稿件分开的独立编号与审核队列。",
    accent: "from-blue-500 to-violet-500",
    bgTint: "bg-blue-50 text-blue-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "tenant:data", "user:data", "events:emit"],
    riskLevel: "medium",
    rationale: "开启后新增发起与投票入口；竞选内容、投票明细与发起人私聊均接入租户与用户数据。",
    enabled: (config) => config.campaigns.enabled,
    setEnabled: (config, value) => ({ ...config, campaigns: { ...config.campaigns, enabled: value } }),
    render: (config, onChange, busy) => <CampaignsPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "aggregateLogin",
    icon: (props: PluginIconProps) => <AggregateLoginPluginIcon className={props.className ?? ""} />,
    name: "聚合登录",
    tagline: "OAuth",
    description: "绑定第三方平台身份后，用 QQ/微信/支付宝等直接登录本校园墙",
    detailedDescription:
      "本插件让登录页展示任意勾选的第三方平台登录方式（QQ、微信、支付宝、抖音、微博、百度、华为、小米、Gitee、Gitea、哔哩哔哩、快手）。\n\n" +
      "工作方式：\n" +
      "· 管理员先在任意一家聚合登录平台申请 appid/appkey，填入下方凭证区。\n" +
      "· 用户登录后可在账号设置页把某个第三方身份绑定到自己的 Campux 账号。\n" +
      "· 之后回到登录页点对应的第三方按钮，即可用该身份直接登录本校园墙。\n" +
      "· 未绑定的第三方身份不会自动创建账号，而是提示先登录已有账号完成绑定。\n\n" +
      "登录方式：可登录的第三方平台由下方「可登录方式」勾选决定，只有勾选的平台会出现在登录页。\n\n" +
      "绑定说明：绑定关系按第三方平台作用域存储（同一用户在多个校园墙各自启用聚合登录时，需分别绑定）。未配凭证或未勾选任何平台时，登录页不会展示第三方登录。",
    author: "HelloFHZ",
    hint: "配置 appid/appkey 并勾选想开放的平台即可。",
    accent: "from-emerald-500 to-teal-500",
    bgTint: "bg-emerald-50 text-emerald-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "user:data", "http:route"],
    riskLevel: "medium",
    rationale: "把第三方社交 UID 建立到本地账号的绑定并用其匹配登录；凭证(appid/appkey)属租户配置，需限制访问。",
    enabled: (config) => config.aggregateLogin.enabled,
    setEnabled: (config, value) => ({ ...config, aggregateLogin: { ...config.aggregateLogin, enabled: value } }),
    render: (config, onChange, busy) => <AggregateLoginPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "broadcast",
    icon: BroadcastIcon,
    name: "广播通知",
    tagline: "Broadcast",
    description: "投稿页发起有时效的广播通知，广播员可标记已广播",
    detailedDescription:
      "本插件在投稿页顶部新增「广播通知」胶囊，让任意用户发起一条有明确时效的校园广播；广播员（或审核员、管理员）在服务页手动登记已广播，并把广播次数记上。\n\n" +
      "发起流程：\n" +
      "· 在投稿页顶部胶囊中切换到「广播通知」，填写通知内容与时效结束时间。\n" +
      "· 时效结束时间最短晚于当前时间 5 分钟，最长 7 天；未选择或超限会提示且不提交。\n" +
      "· 草稿按校园墙隔离自动保存到浏览器本地（localStorage），刷新后可继续编辑。\n" +
      "· 点击「发布通知」即生效，无需审核，立即出现在服务页的广播通知列表。\n\n" +
      "服务页 → 广播通知：\n" +
      "· 两个胶囊：新通知（尚未过时效）与历史通知（已过期），历史通知支持搜索。\n" +
      "· 新通知按三色排序：未通知（红）→ 已修改（橙）→ 已通知（绿），同色组内按结束时间近的排前。\n" +
      "· 历史通知按发出时间从新到旧。\n" +
      "· 通知卡片展示：通知者头像、通知内容、发出时间、结束时间、广播次数。\n\n" +
      "角色与操作：\n" +
      "· 「已广播」：广播员、审核员、管理员可点，弹窗确认后广播次数 +1；未通知的卡片显示「未通知」。\n" +
      "· 「违规删除」：广播员、审核员、管理员可点，需二次确认，删除后通知永久移除。\n" +
      "· 修改：只有通知发出者本人可在时效结束前修改内容与时效结束时间；修改后卡片变橙色，并追加一条历史版本。\n" +
      "· 历史版本：可查看每一版的发出/修改时间、结束时间与当版广播次数。\n\n" +
      "身份设置：\n" +
      "· 广播员是独立于审核员/管理员之外的新身份，不拥有稿件审核能力。\n" +
      "· 管理员在「管理 → 用户管理」中把用户身份改为「广播员」。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "新增身份组「广播员」，用于标记已广播与违规删除。",
    accent: "from-orange-500 to-rose-500",
    bgTint: "bg-orange-50 text-orange-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "tenant:data", "user:data"],
    riskLevel: "medium",
    rationale: "开启后投稿页与服务页新增广播入口；通知内容、广播计数与作者头像均接入租户与用户数据。",
    enabled: (config) => config.broadcast.enabled,
    setEnabled: (config, value) => ({ ...config, broadcast: { ...config.broadcast, enabled: value } }),
    render: (config, onChange, busy) => <BroadcastPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "feedback" as const,
    icon: FeedbackIcon,
    name: "意见反馈",
    tagline: "Feedback",
    description: "投稿页顶部意见反馈入口，提交后通知审核群",
    detailedDescription: "开启后投稿页最上方出现意见反馈入口。意见先保存到站点，墙号在线且已开启审核群通知时同步到审核群。通知失败时意见仍已保存。",
    author: "haohaoxuedili",
    hint: "开启即可用；通知发到审核群。",
    accent: "from-sky-500 to-cyan-500",
    bgTint: "bg-sky-50 text-sky-700",
    role: "admin" as const,
    required: ["config:read", "db:read", "db:write", "tenant:data", "user:data"],
    riskLevel: "medium" as const,
    rationale: "开启后用户可提交文字意见并通知审核群。",
    enabled: (config: TenantPluginConfig) => config.feedback.enabled,
    setEnabled: (config: TenantPluginConfig, value: boolean) => ({ ...config, feedback: { ...config.feedback, enabled: value } }),
    render: () => <FeedbackPanel />,
  },
  {
    id: "botAlert" as const,
    icon: BotAlertIcon,
    name: "Bot 异常通知",
    tagline: "Alert",
    description: "登录态失效自动刷新失败时，邮件通知管理员",
    detailedDescription: "开启后，当 QZone 登录态失效且自动刷新失败时，向配置的邮箱发送异常通知。管理员可配置 SMTP 服务器、端口、发件邮箱、密码，以及多个收件邮箱。",
    author: "haohaoxuedili",
    hint: "配置 SMTP 后开启即可用。",
    accent: "from-rose-500 to-orange-500",
    bgTint: "bg-rose-50 text-rose-700",
    role: "admin" as const,
    required: ["config:read", "db:read", "db:write", "tenant:data"],
    riskLevel: "medium" as const,
    rationale: "开启后登录态失效自动刷新失败时邮件通知管理员；需读写插件配置与租户数据。",
    enabled: (config: TenantPluginConfig) => config.botAlert.enabled,
    setEnabled: (config: TenantPluginConfig, value: boolean) => ({ ...config, botAlert: { ...config.botAlert, enabled: value } }),
    render: (config: TenantPluginConfig, onChange: (next: TenantPluginConfig) => void, busy: boolean) => (
      <BotAlertPanel config={config} onChange={onChange} busy={busy} />
    ),
  },
  {
    id: "graduation",
    icon: GraduationIcon,
    name: "毕业去向",
    tagline: "Graduation",
    description: "投稿页自填级/届与学历，审核通过后进入服务页四视图统计",
    detailedDescription:
      "本插件让毕业生在投稿页提交自己的毕业信息：入学年份（级）、毕业年份（届）、毕业时学历（如读高中毕业就是高中学历）、毕业去向（学校/单位全称）；提交后进入审核队列，审核员在审核群或网页端手动通过/驳回。\n\n" +
      "投稿页：\n" +
      "· 顶部胶囊新增「毕业去向」选项，选择后展示表单。\n" +
      "· 入学年份（级）与毕业年份（届）均由投稿人自行填写，不做任何自动换算；毕业年份早于入学年份时不允许提交。\n" +
      "· 毕业时学历自由填写（提供初中/高中/大专/本科等常用项快捷填入），如中专、职高、专升本也可直接输入。\n" +
      "· 每个用户在同一校园墙内仅允许一份「待审核 + 已通过」的记录（驳回后可重新提交）。\n\n" +
      "审核流程：\n" +
      "· 提交后自动推送审核群，包含届/级、学历、去向与作者名。\n" +
      "· 审核群命令：#毕业通过 <编号> / #毕业拒绝 <理由> <编号>。\n" +
      "· 网页端在「服务页 → 毕业生去向 → 待审核」展示「通过」与「驳回」两个按钮，驳回需填写理由。\n\n" +
      "服务页 → 毕业生去向：\n" +
      "· 用户列表：头像 + 姓名 + QQ，点击展开详情（入学年/毕业年/学历/去向）；顶部显示已填写人数。\n" +
      "· 学校列表：聚合展示每个学校的人数，点击展开具体人员。\n" +
      "· 时间视图：可按届/级/提交时间排序，可升/降序，可筛选指定年份。\n" +
      "· 搜索：支持 QQ 号 / 用户名 / 学校名关键词模糊匹配。\n\n" +
      "管理：\n" +
      "· 插件仅有开关，无需配置年限换算规则；级与届都由投稿人自己填。\n" +
      "· 插件禁用后，投稿页胶囊与服务页入口同时隐藏；已有数据不受影响。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "级与届均由投稿人自填；审核群命令与网页审核双通道。",
    accent: "from-violet-500 to-pink-500",
    bgTint: "bg-violet-50 text-violet-700",
    role: "admin",
    required: ["config:read", "db:read", "db:write", "tenant:data", "user:data"],
    riskLevel: "medium",
    rationale: "开启后投稿页与服务页新增毕业去向入口；毕业信息（届/级/学历/去向）与作者 QQ 关联，仅供审核员统计查阅。",
    enabled: (config) => config.graduation.enabled,
    setEnabled: (config, value) => ({ ...config, graduation: { ...config.graduation, enabled: value } }),
    render: (config, onChange, busy) => <GraduationPanel config={config} onChange={onChange} busy={busy} />,
  },
  {
    id: "todayInHistory",
    icon: TodayInHistoryIcon,
    name: "那年今日",
    tagline: "History",
    description: "投稿页胶囊展示历史上同一月同一日的已发布稿件，按年份倒序分组",
    detailedDescription:
      "本插件在投稿页顶部新增「那年今日」胶囊，点击后展示本校园墙历史上同一月同一日发布过的稿件，按年份从近到远分组，每个年份以大字标出。\n\n" +
      "投稿页：\n" +
      "· 顶部胶囊新增「那年今日」选项，选择后展示历史稿件列表。\n" +
      "· 年份倒序排列：先显示最近一年同日的稿件，再往前一年，直到没有更多数据。\n" +
      "· 支持批量发布稿件与独立发布稿件，图片与文字同时展示。\n\n" +
      "数据口径：\n" +
      "· 仅统计已发布状态且属于当前校园墙的稿件。\n" +
      "· 日期按校园墙所在时区（Asia/Shanghai）的日历日判定；稿件发布时刻取稿件最近一次更新时间或批次冲洗时间。\n\n" +
      "管理：\n" +
      "· 插件仅有开关，无需配置其他项；禁用后投稿页胶囊隐藏，已有数据不受影响。",
    author: DEFAULT_PLUGIN_AUTHOR,
    hint: "仅读取已发布稿件，无写入操作。",
    accent: "from-rose-500 to-amber-500",
    bgTint: "bg-rose-50 text-rose-700",
    role: "admin",
    required: ["config:read", "db:read", "tenant:data", "user:data"],
    riskLevel: "low",
    rationale: "开启后投稿页新增那年今日入口，仅读取已发布稿件并按年月日筛选，不写入任何数据。",
    enabled: (config) => config.todayInHistory.enabled,
    setEnabled: (config, value) => ({ ...config, todayInHistory: { ...config.todayInHistory, enabled: value } }),
    render: (config, onChange, busy) => <TodayInHistoryPanel config={config} onChange={onChange} busy={busy} />,
  },
];

/**
 * 插件展示元数据（图标 / 名称 / 简介 / 作者 / 配色）。
 *
 * 服务页的关于页需要在不进入管理端的情况下列出插件与作者，这里从配置页同一份
 * PLUGINS 派生，避免两处各维护一份插件清单而漂移。
 */
export const PLUGIN_SHOWCASE = PLUGINS.map(({ id, icon, name, tagline, detailedDescription, author, hint }) => ({
  id,
  icon,
  name,
  tagline,
  detailedDescription,
  author,
  hint,
}));

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
    campaigns: {
      enabled: metadata.enableCampaigns ?? false,
      allowAnonymousCreate: metadata.allowAnonymousCampaign ?? false,
      // 插件关闭时后端下发 0，初始化为 1 以免新建租户保存后直接变为 0。
      maxActivePerUser: metadata.maxActiveCampaignsPerUser && metadata.maxActiveCampaignsPerUser > 0 ? metadata.maxActiveCampaignsPerUser : 1,
    },
    aggregateLogin: {
      enabled: false,
      loginTypes: [],
      appId: "",
      appKey: "",
      endpoint: "",
    },
    broadcast: {
      enabled: false,
      quickPresets: [],
    },
    feedback: {
      enabled: metadata.enableFeedback ?? false,
    },
    botAlert: {
      enabled: metadata.enableBotAlert ?? false,
      smtpHost: "",
      smtpPort: 465,
      smtpUser: "",
      smtpPass: "",
      fromEmail: "",
      toEmails: [],
    },
    graduation: {
      enabled: false,
    },
    todayInHistory: {
      enabled: false,
    },
  };
}

// 「日志」Tab 的详细记录：从审计 metadata 的 before/after 提取发生变化的字段。
function extractAuditDiff(metadata: Record<string, unknown> | null | undefined): Array<{ key: string; before: string; after: string }> {
  const before = metadata?.before;
  const after = metadata?.after;
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) return [];
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const diff: Array<{ key: string; before: string; after: string }> = [];
  for (const key of new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])) {
    const beforeText = JSON.stringify(beforeRecord[key]) ?? "undefined";
    const afterText = JSON.stringify(afterRecord[key]) ?? "undefined";
    if (beforeText !== afterText) diff.push({ key, before: beforeText, after: afterText });
  }
  return diff;
}

// 日志值展示：过长截断，避免单条记录撑爆卡片。
function formatAuditValue(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export function PluginConfigPage({ tenantId, metadata, onSaved }: { tenantId: string; metadata: TenantMetadata; onSaved?: () => void | Promise<void> }) {
  const [config, setConfig] = useState<TenantPluginConfig>(() => ensureFontSelectionDefaults(ensureBotMessageDefaults(buildInitialConfig(metadata))));
  const [activeId, setActiveId] = useState<PluginId>("markdownRender");
  const [activeTab, setActiveTab] = useState<"config" | "info" | "log">("config");
  const [broadcasterMigration, setBroadcasterMigration] = useState<Array<{ member: AdminMember; nextRole: TenantRole }> | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // 预设插件启用集合：来自 /api/admin/plugins 的 registry status。
  // 侧栏展示所有预设插件（无论是否启用），每行带启停开关。
  const [enabledPresetNames, setEnabledPresetNames] = useState<Set<string>>(new Set());
  // 侧栏插件列表可折叠；默认展开。
  const [showSidebarPlugins, setShowSidebarPlugins] = useState(true);
  // 单插件启停中，避免重复点。
  const [togglingName, setTogglingName] = useState<string | null>(null);
  // 配置日志：来自 /api/admin/plugins/audit，支持按插件筛选。
  const [auditLog, setAuditLog] = useState<Array<{ id: string; timestamp: string; action: string; pluginName: string; operator: string | null; detail: string | null; metadata: Record<string, unknown> | null }>>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [logScope, setLogScope] = useState<"all" | "current">("current");
  // 最近一次已保存/已加载的 botAlert 配置快照（JSON）：save() 用它判断 botAlert
  // 是否有未测试的修改 —— 无论当前在哪个插件面板，整份 config 是一次性 PATCH 的。
  const savedBotAlertRef = useRef<string | null>(null);


  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    void loadConfig();
    return undefined;
  }, [tenantId]);

  // 拉取最新插件配置（含聚合登录等预设插件的 enabled 状态）。
  async function loadConfig() {
    if (!tenantId) return;
    setLoading(true);
    try {
      const data = await api<{ config: TenantPluginConfig }>("/api/admin/plugins/settings");
      const next = ensureFontSelectionDefaults(ensureBotMessageDefaults(data.config));
      setConfig(next);
      savedBotAlertRef.current = JSON.stringify(next.botAlert);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取插件配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    api<{ plugins: Array<{ name: string; status: "enabled" | "disabled" }> }>("/api/admin/plugins")
      .then((data) => {
        if (cancelled) return;
        setEnabledPresetNames(new Set(data.plugins.filter((p) => p.status === "enabled" && PRESET_REGISTRY_NAMES.has(p.name)).map((p) => p.name)));
      })
      .catch(() => { /* 读取失败时保持空集合，避免误显示 */ });
    return () => { cancelled = true; };
  }, [tenantId]);
  // 保存后 registry 状态可能变化，拉取一次保持侧栏同步
  async function refreshEnabledPlugins() {
    if (!tenantId) return;
    try {
      const data = await api<{ plugins: Array<{ name: string; status: "enabled" | "disabled" }> }>("/api/admin/plugins");
      setEnabledPresetNames(new Set(data.plugins.filter((p) => p.status === "enabled" && PRESET_REGISTRY_NAMES.has(p.name)).map((p) => p.name)));
    } catch {
      // 静默失败；下一次拉取会重新同步。
    }
  }
  async function save() {
    setBusy(true);
    try {
      // botAlert 专有门禁：只要有未测试过的 botAlert 修改（无论当前在哪个面板，
      // 整份 config 是一次性 PATCH 的），保存前必须先通过测试邮件，避免静默
      // 保存发不出去的 SMTP/收件配置（服务端只校验字段长度，不校验可达性）。
      let configToSave = config;
      const botAlertDirty =
        savedBotAlertRef.current !== null && config.botAlert !== undefined && JSON.stringify(config.botAlert) !== savedBotAlertRef.current;
      if (botAlertDirty) {
        // 先丢弃没填完的空行，再拿清理后的收件列表做测试与保存。
        configToSave = { ...config, botAlert: { ...config.botAlert, toEmails: config.botAlert.toEmails.map((s) => s.trim()).filter(Boolean) } };
        const test = await api<{ ok: boolean; message: string }>("/api/admin/plugins/bot-alert/test", {
          method: "POST",
          body: JSON.stringify({
            smtpHost: configToSave.botAlert.smtpHost,
            smtpPort: configToSave.botAlert.smtpPort,
            smtpUser: configToSave.botAlert.smtpUser,
            smtpPass: configToSave.botAlert.smtpPass,
            fromEmail: configToSave.botAlert.fromEmail,
            toEmails: configToSave.botAlert.toEmails,
          }),
        });
        toast.success(test.message || "测试邮件已发送");
        setConfig(configToSave);
      }
      await api("/api/admin/plugins/settings", { method: "PATCH", body: JSON.stringify(configToSave) });
      savedBotAlertRef.current = JSON.stringify(configToSave.botAlert);
      toast.success("插件配置已保存");
      await onSaved?.();
      // 保存可能触发插件启停变化，重新拉一次列表保持侧栏同步。
      void refreshEnabledPlugins();
      void refreshAuditLog();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "插件配置保存失败");
    } finally {
      setBusy(false);
    }
  }

  // 侧栏展示所有预设插件（启用与未启用共存），每行带启停开关。
  // 禁用后配置面板不可编辑，但开关仍可重新开启。
  const activePlugin: PluginDescriptor = PLUGINS.find((plugin) => plugin.id === activeId) ?? PLUGINS[0]!;
  const activePluginEnabled = enabledPresetNames.has(PRESET_NAME_BY_ID[activePlugin.id]);

  // 若当前选中的插件不存在（理论上不会发生），回到第一个。
  useEffect(() => {
    if (!PLUGINS.some((plugin) => plugin.id === activeId)) {
      setActiveId(PLUGINS[0]!.id);
    }
  }, [activeId]);

  async function applyPluginStatus(registryName: string, nextStatus: "enabled" | "disabled") {
    await api(`/api/admin/plugins/${encodeURIComponent(registryName)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus }),
    });
    const nextSet = new Set(enabledPresetNames);
    if (nextStatus === "disabled") nextSet.delete(registryName);
    else nextSet.add(registryName);
    setEnabledPresetNames(nextSet);
    // 预设插件的启用状态也写入 plugin_config.<id>.enabled，重拉一次配置，
    // 避免本地 config state 里的旧 enabled 在下次「保存」时把开启状态覆盖回禁用。
    void loadConfig();
    // 启停会改变插件透出的租户元数据（如 enableBroadcast），通知父级刷新，
    // 否则管理页「用户」面板的角色选项不会立即跟随开关状态。
    try { await onSaved?.(); } catch { /* 元数据刷新失败不影响插件启停 */ }
    toast.success(nextStatus === "disabled" ? "已禁用插件" : "已启用插件");
    void refreshAuditLog();
  }

  async function togglePlugin(pluginId: PluginId) {
    const registryName = PRESET_NAME_BY_ID[pluginId];
    const isEnabled = enabledPresetNames.has(registryName);
    const nextStatus: "enabled" | "disabled" = isEnabled ? "disabled" : "enabled";
    setTogglingName(registryName);
    try {
      // 关闭广播通知前：若墙内仍有广播员，先弹窗逐人迁移身份；
      // 未修改的广播员在确认后统一改为「用户」，再真正关闭插件。
      if (pluginId === "broadcast" && nextStatus === "disabled") {
        const data = await api<{ members: AdminMember[] }>("/api/admin/members?role=broadcaster&limit=50");
        if (data.members.length > 0) {
          setBroadcasterMigration(data.members.map((member) => ({ member, nextRole: "submitter" as const })));
          return;
        }
      }
      await applyPluginStatus(registryName, nextStatus);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "插件启停失败");
    } finally {
      setTogglingName(null);
    }
  }

  async function confirmBroadcasterMigration() {
    if (!broadcasterMigration) return;
    setMigrationBusy(true);
    try {
      await Promise.all(
        broadcasterMigration.map(({ member, nextRole }) =>
          api(`/api/admin/members/${member.id}`, { method: "PATCH", body: JSON.stringify({ role: nextRole }) }),
        ),
      );
      setBroadcasterMigration(null);
      await applyPluginStatus(PRESET_NAME_BY_ID.broadcast, "disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "广播员身份修改失败");
    } finally {
      setMigrationBusy(false);
    }
  }

  async function refreshAuditLog() {
    setAuditLogLoading(true);
    try {
      const data = await api<{ auditLog: Array<{ id: string; timestamp: string; action: string; pluginName: string; operator: string | null; detail: string | null; metadata: Record<string, unknown> | null }> }>("/api/admin/plugins/audit?limit=50");
      setAuditLog(data.auditLog);
    } catch {
      // 读取失败时保留旧列表
    } finally {
      setAuditLogLoading(false);
    }
  }

  // 日志 Tab 首次激活时拉取；开启/关闭插件、保存后自动刷新。
  useEffect(() => {
    if (activeTab === "log" && auditLog.length === 0 && !auditLogLoading) void refreshAuditLog();
  }, [activeTab, auditLog.length, auditLogLoading]);

  return (
    <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
      <Card className="rounded-md border-slate-200 bg-white shadow-none">
        <CardContent className="flex h-full flex-col p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md bg-slate-50 ring-1 ring-slate-200"><PluginConfigIcon className="size-6" /></span>
              <div>
                <p className="text-sm font-semibold text-slate-900">插件</p>
                <p className="text-xs text-slate-500">{PLUGINS.length} 个插件 · {enabledPresetNames.size} 个已启用</p>
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
          <div className="grid gap-1 overflow-y-auto md:grid-flow-row md:grid-rows-[1fr]">
            {showSidebarPlugins ? (
              <div className="flex flex-col gap-1 md:overflow-visible">
                {PLUGINS.map((plugin) => {
                  const registryName = PRESET_NAME_BY_ID[plugin.id];
                  const isActive = plugin.id === activeId;
                  const isEnabled = enabledPresetNames.has(registryName);
                  const isToggling = togglingName === registryName;
                  return (
                    <div key={plugin.id} className={`flex items-center gap-2 rounded-md p-2 ${isActive ? "bg-slate-100" : "hover:bg-slate-50"}`} data-active={isActive || undefined}>
                      <button
                        type="button"
                        onClick={() => setActiveId(plugin.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className={`grid size-9 shrink-0 place-items-center rounded-md bg-gradient-to-br text-white ${isEnabled ? "" : "opacity-50"}`} style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}><plugin.icon className="size-5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{plugin.name}</p>
                          <p className={`hidden truncate text-xs md:block ${isEnabled ? "text-slate-500" : "text-slate-400"}`}>{isEnabled ? plugin.tagline : "已禁用"}</p>
                        </div>
                      </button>
                      <Switch
                        checked={isEnabled}
                        size="sm"
                        disabled={isToggling}
                        onCheckedChange={() => void togglePlugin(plugin.id)}
                        aria-label={`${plugin.name} 启停开关`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : null}
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
          ) : (
            <div className="flex-1 space-y-4 overflow-y-auto">
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gradient-to-br text-white sm:size-12" style={{ background: `linear-gradient(135deg, var(--tw-gradient-stops))` }}><activePlugin.icon className="size-5 sm:size-6" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-slate-900">{activePlugin.name}</p>
                  <p className="text-xs text-slate-500">{activePlugin.description}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400"><UserIcon className="size-3" />作者：{activePlugin.author}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
                    {[
                      { key: "config", label: "配置" },
                      { key: "info", label: "说明" },
                      { key: "log", label: "日志" },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key as "config" | "info" | "log")}
                        className={
                          activeTab === tab.key
                            ? "rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm"
                            : "rounded-full px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-900"
                        }
                      >{tab.label}</button>
                    ))}
                  </div>
                </div>
              </div>
              {activeTab === "config" ? (
                <>
                  <div className={activePluginEnabled ? "" : "pointer-events-none opacity-50"}>
                    {activePlugin.render(config, setConfig, busy)}
                  </div>
                  {activePluginEnabled ? null : (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <p className="font-semibold">当前插件已禁用</p>
                      <p className="mt-1">请在左侧插件列表中将开关打开，配置修改才会生效。</p>
                    </div>
                  )}
                </>
              ) : null}
              {activeTab === "info" ? (
                <div className="space-y-3 text-sm leading-6 text-slate-700">
                  <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                    {activePlugin.detailedDescription}
                  </p>
                  <div>
                    <p className="text-xs font-medium text-slate-500">使用建议</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{activePlugin.hint}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">风险声明</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{activePlugin.rationale}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">所需权限</p>
                    <div className="mt-2">
                      <PermissionBadge permissions={activePlugin.required} risk={activePlugin.riskLevel} rationale={activePlugin.rationale} />
                    </div>
                  </div>
                </div>
              ) : null}
              {activeTab === "log" ? (
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-1 text-[11px] text-slate-400">
                    <button
                      type="button"
                      onClick={() => setLogScope("current")}
                      className={logScope === "current" ? "rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700" : "rounded px-2 py-0.5 hover:bg-slate-50"}
                    >当前插件</button>
                    <button
                      type="button"
                      onClick={() => setLogScope("all")}
                      className={logScope === "all" ? "rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-700" : "rounded px-2 py-0.5 hover:bg-slate-50"}
                    >全部插件</button>
                  </div>
                  <div className="mt-2">
                    {auditLogLoading && auditLog.length === 0 ? (
                      <div className="grid place-items-center py-6 text-xs text-slate-400"><LoaderIcon className="size-4 animate-spin" /> 加载中…</div>
                    ) : (
                      (() => {
                        const filtered = logScope === "current"
                          ? filterPluginAuditLogs(auditLog, activePlugin.id, PRESET_NAME_BY_ID[activePlugin.id])
                          : auditLog;
                        if (filtered.length === 0) {
                          return <p className="py-4 text-center text-xs text-slate-400">暂无日志</p>;
                        }
                        return (
                          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                            {filtered.map((entry) => (
                              <div key={entry.id} className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700">{entry.action}</span>
                                  <span className="font-mono text-xs text-slate-600">{entry.pluginName}</span>
                                  <span className="ml-auto font-mono text-xs text-slate-400">{new Date(entry.timestamp).toLocaleString("zh-CN", { hour12: false })}</span>
                                </div>
                                {entry.detail ? <p className="mt-1 text-xs leading-5 text-slate-600">{entry.detail}</p> : null}
                                {(() => {
                                  const diff = extractAuditDiff(entry.metadata);
                                  return diff.length > 0 ? (
                                    <div className="mt-1.5 space-y-0.5 rounded-md bg-white p-2 ring-1 ring-slate-100">
                                      {diff.map((item) => (
                                        <p key={item.key} className="break-all font-mono text-[11px] leading-5 text-slate-500">
                                          <span className="font-semibold text-slate-700">{item.key}</span>：{formatAuditValue(item.before)} → {formatAuditValue(item.after)}
                                        </p>
                                      ))}
                                    </div>
                                  ) : null;
                                })()}
                                {entry.operator ? <p className="mt-0.5 text-[11px] text-slate-400">操作人：{entry.operator}</p> : null}
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={broadcasterMigration !== null} onOpenChange={(open) => { if (!open && !migrationBusy) setBroadcasterMigration(null); }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>关闭广播通知前，请处理广播员身份</DialogTitle>
            <DialogDescription>
              当前有 {broadcasterMigration?.length ?? 0} 名广播员。可为每人选择新身份；保持默认不修改的广播员，确认后会改为「{roleLabels.submitter}」。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {broadcasterMigration?.map(({ member, nextRole }) => (
              <div key={member.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{member.user.displayName ?? member.user.qqUin}</p>
                  <p className="text-xs text-slate-500">QQ {member.user.qqUin}</p>
                </div>
                <Select value={nextRole} onValueChange={(role) => setBroadcasterMigration((current) => current?.map((entry) => entry.member.id === member.id ? { ...entry, nextRole: role as TenantRole } : entry) ?? null)}>
                  <SelectTrigger className="w-28 bg-white font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="submitter">{roleLabels.submitter}</SelectItem>
                    <SelectItem value="reviewer">{roleLabels.reviewer}</SelectItem>
                    <SelectItem value="admin">{roleLabels.admin}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={migrationBusy} onClick={() => setBroadcasterMigration(null)}>取消</Button>
            <Button disabled={migrationBusy} onClick={() => void confirmBroadcasterMigration()}>{migrationBusy ? "处理中…" : "确认并关闭插件"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


