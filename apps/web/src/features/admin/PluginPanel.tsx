import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  PuzzleIcon,
  PowerIcon,
  PowerOffIcon,
  ActivityIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  InfoIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserIcon,
} from "lucide-react";
import {
  MarkdownIcon,
  ColorIcon,
  FontIcon,
  AnonymousAvatarIcon,
  BotIcon,
  PluginConfigIcon,
} from "./PluginConfigPage";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyCard } from "@/components/app/utility";

type PluginInfo = {
  name: string;
  version: string;
  description: string | null;
  campuxVersion: string | null;
  hasInit: boolean;
  hasReady: boolean;
  hasClose: boolean;
  status: "enabled" | "disabled";
};

type PluginsResponse = {
  plugins: PluginInfo[];
};

// 预设插件在 registry 里没有图标/作者元数据，前端按 name 兜底补上；
// 未来服务端在 /api/admin/plugins 返回这些字段后可去掉本映射。
type PresetIconProps = { className?: string };
const PRESET_ICON_BY_NAME: Record<string, ComponentType<PresetIconProps>> = {
  "campux-plugin-markdown-render": MarkdownIcon,
  "campux-plugin-color-selection": ColorIcon,
  "campux-plugin-font-selection": FontIcon,
  "campux-plugin-anonymous-avatar": AnonymousAvatarIcon,
  "campux-plugin-bot-stylish-messages": BotIcon,
};
const PRESET_ICON_FALLBACK = PuzzleIcon;
const DEFAULT_PLUGIN_AUTHOR = "MrWoods1692";

type EventLogEntry = {
  timestamp: string;
  type: string;
  tenantId?: string;
  postId?: string;
  reviewerId?: string;
  userId?: string;
  [key: string]: unknown;
};

type EventLogResponse = {
  events: EventLogEntry[];
};

type PermissionInfo = {
  name: string;
  required: string[];
  riskLevel: string;
  rationale: string | null;
};

type PermissionsResponse = {
  permissions: PermissionInfo[];
};

type AuditLogEntry = {
  id: string;
  timestamp: string;
  action: string;
  pluginName: string;
  operator: string | null;
  detail: string | null;
  metadata: Record<string, unknown> | null;
};

type AuditLogResponse = {
  auditLog: AuditLogEntry[];
};

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [showEventLog, setShowEventLog] = useState(false);
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
  const [showPermissions, setShowPermissions] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [showAuditLog, setShowAuditLog] = useState(false);
  // 已注册插件列表可折叠；默认展开。
  const [showAllPlugins, setShowAllPlugins] = useState(true);
  // 信息弹窗：记录当前选中的插件名，null 时关闭。
  const [infoPluginName, setInfoPluginName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<PluginsResponse>("/api/admin/plugins");
        if (!cancelled) {
          setPlugins(data.plugins);
        }
      } catch (caught) {
        if (!cancelled) {
          toast.error(caught instanceof Error ? caught.message : "无法加载插件列表");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadEventLog() {
    try {
      const data = await api<EventLogResponse>("/api/admin/plugins/events?limit=50");
      setEventLog(data.events);
      setShowEventLog(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "无法加载事件日志");
    }
  }

  async function loadPermissions() {
    try {
      const data = await api<PermissionsResponse>("/api/admin/plugins/permissions");
      setPermissions(data.permissions);
      setShowPermissions(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "无法加载权限信息");
    }
  }

  async function loadAuditLog() {
    try {
      const data = await api<AuditLogResponse>("/api/admin/plugins/audit?limit=50");
      setAuditLog(data.auditLog);
      setShowAuditLog(true);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "无法加载审计日志");
    }
  }

  async function togglePlugin(name: string, currentStatus: "enabled" | "disabled") {
    const newStatus = currentStatus === "enabled" ? "disabled" : "enabled";
    setToggling(name);
    try {
      await api(`/api/admin/plugins/${encodeURIComponent(name)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      setPlugins((prev) =>
        prev.map((p) => (p.name === name ? { ...p, status: newStatus } : p))
      );
      toast.success(`插件 "${name}" 已${newStatus === "enabled" ? "启用" : "禁用"}`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">
        <span className="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        正在加载插件列表...
      </div>
    );
  }

  const enabledCount = plugins.filter((p) => p.status === "enabled").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-slate-50 ring-1 ring-slate-200"><PluginConfigIcon className="size-6" /></span>
        <button
          type="button"
          onClick={() => setShowAllPlugins((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
          title={showAllPlugins ? "收起插件列表" : "展开插件列表"}
        >
          {showAllPlugins ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          <PuzzleIcon className="size-5 text-slate-600" />
          <h2 className="text-base font-bold text-slate-900">已注册插件</h2>
          <Badge variant="secondary">{plugins.length}</Badge>
          {enabledCount < plugins.length ? (
            <span className="text-xs text-slate-400">
              ({enabledCount} 已启用)
            </span>
          ) : null}
        </button>
      </div>

      {plugins.length === 0 ? (
        <EmptyCard title="暂无已注册的插件" />
      ) : showAllPlugins ? (
        <div className="grid gap-3">
          {plugins.map((plugin) => {
            const Icon = PRESET_ICON_BY_NAME[plugin.name] ?? PRESET_ICON_FALLBACK;
            const author = DEFAULT_PLUGIN_AUTHOR;
            return (
            <div
              key={plugin.name}
              className={`rounded-lg border bg-white p-4 transition ${
                plugin.status === "disabled"
                  ? "border-slate-200 opacity-60"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-50 ring-1 ring-slate-200">
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-slate-900">
                      {plugin.name}
                    </h3>
                    {plugin.description ? (
                      <p className="mt-1 text-xs text-slate-500">{plugin.description}</p>
                    ) : null}
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                      <UserIcon className="size-3" />
                      <span>作者：{author}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInfoPluginName(plugin.name)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
                    title="插件说明"
                  >
                    <InfoIcon className="size-3" />
                    说明
                  </button>
                  <StatusBadge status={plugin.status} />
                  <Badge variant="outline" className="shrink-0">
                    v{plugin.version}
                  </Badge>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <LifecycleBadge label="onInit" active={plugin.hasInit} />
                <LifecycleBadge label="onReady" active={plugin.hasReady} />
                <LifecycleBadge label="onClose" active={plugin.hasClose} />
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={toggling === plugin.name}
                  onClick={() => togglePlugin(plugin.name, plugin.status)}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    plugin.status === "enabled"
                      ? "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                      : "border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                  } disabled:opacity-50`}
                >
                  {toggling === plugin.name ? (
                    <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : plugin.status === "enabled" ? (
                    <PowerOffIcon className="size-3" />
                  ) : (
                    <PowerIcon className="size-3" />
                  )}
                  {plugin.status === "enabled" ? "禁用" : "启用"}
                </button>
              </div>

              {plugin.campuxVersion ? (
                <p className="mt-2 text-xs text-slate-400">
                  兼容 Campux {plugin.campuxVersion}
                </p>
              ) : null}
            </div>
            );
          })}
        </div>
      ) : null}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold text-slate-500">
          插件在服务端注册，通过事件系统与核心功能交互。禁用插件将在下次服务重启后生效（已禁用的插件不会执行生命周期钩子）。如需添加或移除插件，请修改服务端配置并重启服务。
        </p>
      </div>

      <PluginInfoDialog
        open={infoPluginName !== null}
        onOpenChange={(open: boolean) => { if (!open) setInfoPluginName(null); }}
        plugin={plugins.find((item) => item.name === infoPluginName) ?? null}
      />

      {/* 事件日志 */}
      <div className="border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => (showEventLog ? setShowEventLog(false) : loadEventLog())}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition"
        >
          <ActivityIcon className="size-3.5" />
          {showEventLog ? "隐藏事件日志" : "查看事件日志"}
        </button>

        {showEventLog ? (
          eventLog.length === 0 ? (
            <EmptyCard title="暂无事件日志" />
          ) : (
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {eventLog.map((entry, index) => (
                <div key={index} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
                      {entry.type}
                    </span>
                    <span className="font-mono text-xs text-slate-400">{new Date(entry.timestamp).toLocaleTimeString("zh-CN")}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">{formatEventDetail(entry)}</p>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>

      {/* 权限声明 */}
      <div className="border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => (showPermissions ? setShowPermissions(false) : loadPermissions())}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition"
        >
          <ShieldIcon className="size-3.5" />
          {showPermissions ? "隐藏权限声明" : "查看权限声明"}
        </button>

        {showPermissions ? (
          permissions.length === 0 ? (
            <EmptyCard title="暂无权限信息" />
          ) : (
            <div className="mt-3 grid gap-2">
              {permissions.map((p) => (
                <div
                  key={p.name}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{p.name}</span>
                    <RiskBadge level={p.riskLevel} />
                  </div>
                  {p.rationale ? (
                    <p className="mt-1 text-xs text-slate-500">{p.rationale}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.required.length === 0 ? (
                      <span className="text-xs text-slate-400">无特殊权限要求</span>
                    ) : (
                      p.required.map((perm) => (
                        <PermissionBadge key={perm} permission={perm} />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>

      {/* 审计日志 */}
      <div className="border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => (showAuditLog ? setShowAuditLog(false) : loadAuditLog())}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition"
        >
          <FileTextIcon className="size-3.5" />
          {showAuditLog ? "隐藏审计日志" : "查看审计日志"}
        </button>

        {showAuditLog ? (
          auditLog.length === 0 ? (
            <EmptyCard title="暂无审计日志" />
          ) : (
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {auditLog.map((entry) => (
                <div key={entry.id} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <AuditActionBadge action={entry.action} />
                    <span className="font-mono text-xs text-slate-600">{entry.pluginName}</span>
                    <span className="ml-auto font-mono text-xs text-slate-400">{new Date(entry.timestamp).toLocaleTimeString("zh-CN")}</span>
                  </div>
                  {entry.detail ? <p className="mt-1.5 text-xs leading-5 text-slate-600">{entry.detail}</p> : null}
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function formatEventDetail(event: EventLogEntry): string {
  const parts: string[] = [];
  if (event.tenantId) parts.push(`tenant=${event.tenantId.slice(0, 8)}...`);
  if (event.postId) parts.push(`post=${event.postId.slice(0, 8)}...`);
  if (event.reviewerId) parts.push(`reviewer=${event.reviewerId.slice(0, 8)}...`);
  if (event.userId) parts.push(`user=${event.userId.slice(0, 8)}...`);
  if (event.reason) parts.push(`reason=${String(event.reason).slice(0, 20)}`);
  return parts.join(" ") || "—";
}

function StatusBadge({ status }: { status: "enabled" | "disabled" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        status === "enabled"
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-slate-100 text-slate-400 border border-slate-200"
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${
          status === "enabled" ? "bg-emerald-500" : "bg-slate-300"
        }`}
      />
      {status === "enabled" ? "已启用" : "未启用"}
    </span>
  );
}

function LifecycleBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
        active
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-slate-100 text-slate-400 border border-slate-200"
      }`}
    >
      {active ? "✓" : "—"} {label}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, { icon: typeof ShieldCheckIcon; className: string; label: string }> = {
    low: {
      icon: ShieldCheckIcon,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      label: "低风险",
    },
    medium: {
      icon: ShieldAlertIcon,
      className: "bg-amber-50 text-amber-700 border-amber-200",
      label: "中风险",
    },
    high: {
      icon: ShieldAlertIcon,
      className: "bg-red-50 text-red-700 border-red-200",
      label: "高风险",
    },
  };
  const cfg = config[level] ?? config.low!;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cfg.className}`}
    >
      <Icon className="size-3" />
      {cfg.label}
    </span>
  );
}

function PermissionBadge({ permission }: { permission: string }) {
  const isHighRisk = ["db:write", "http:route", "user:data"].includes(permission);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-mono font-semibold ${
        isHighRisk
          ? "bg-red-50 text-red-700 border border-red-200"
          : "bg-slate-100 text-slate-600 border border-slate-200"
      }`}
    >
      {permission}
    </span>
  );
}

function AuditActionBadge({ action }: { action: string }) {
  const config: Record<string, string> = {
    "plugin:registered": "bg-blue-50 text-blue-700",
    "plugin:status_changed": "bg-amber-50 text-amber-700",
    "plugin:permission_check": "bg-purple-50 text-purple-700",
    "plugin:request_sent": "bg-cyan-50 text-cyan-700",
    "plugin:response_received": "bg-emerald-50 text-emerald-700",
    "plugin:error": "bg-red-50 text-red-700",
    "tenant.plugin.markdownRender.enable": "bg-emerald-50 text-emerald-700",
    "tenant.plugin.markdownRender.disable": "bg-rose-50 text-rose-700",
    "tenant.plugin.markdownRender.config": "bg-slate-100 text-slate-600",
    "tenant.plugin.colorSelection.enable": "bg-emerald-50 text-emerald-700",
    "tenant.plugin.colorSelection.disable": "bg-rose-50 text-rose-700",
    "tenant.plugin.colorSelection.config": "bg-slate-100 text-slate-600",
    "tenant.plugin.fontSelection.enable": "bg-emerald-50 text-emerald-700",
    "tenant.plugin.fontSelection.disable": "bg-rose-50 text-rose-700",
    "tenant.plugin.fontSelection.config": "bg-slate-100 text-slate-600",
    "tenant.plugin.anonymousAvatar.enable": "bg-emerald-50 text-emerald-700",
    "tenant.plugin.anonymousAvatar.disable": "bg-rose-50 text-rose-700",
    "tenant.plugin.anonymousAvatar.config": "bg-slate-100 text-slate-600",
    "tenant.plugin.botStylishMessages.enable": "bg-emerald-50 text-emerald-700",
    "tenant.plugin.botStylishMessages.disable": "bg-rose-50 text-rose-700",
    "tenant.plugin.botStylishMessages.config": "bg-slate-100 text-slate-600",
  };
  const className = config[action] ?? "bg-slate-50 text-slate-600";
  const label: Record<string, string> = {
    "plugin:registered": "注册",
    "plugin:status_changed": "状态变更",
    "plugin:permission_check": "权限检查",
    "plugin:request_sent": "请求发送",
    "plugin:response_received": "响应接收",
    "plugin:error": "错误",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
    >
      {label[action] ?? action}
    </span>
  );
}

function PluginInfoDialog({
  open,
  onOpenChange,
  plugin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: PluginInfo | null;
}) {
  if (!plugin) return null;
  const Icon = PRESET_ICON_BY_NAME[plugin.name] ?? PRESET_ICON_FALLBACK;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-10">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-slate-100 ring-1 ring-slate-200">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{plugin.name}</DialogTitle>
              <DialogDescription className="mt-0.5 inline-flex items-center gap-1 text-xs">
                <UserIcon className="size-3" />
                作者：{DEFAULT_PLUGIN_AUTHOR}
                <span className="mx-1 text-slate-300">·</span>
                v{plugin.version}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-3 px-5 pb-5 text-sm leading-6 text-slate-700">
          {plugin.description ? (
            <p className="rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              {plugin.description}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-slate-600 ring-1 ring-slate-200">
              版本：{plugin.version}
            </span>
            {plugin.campuxVersion ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-slate-600 ring-1 ring-slate-200">
                兼容 Campux：{plugin.campuxVersion}
              </span>
            ) : null}
            <StatusBadge status={plugin.status} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-slate-200 p-2">
              <p className="text-slate-400">onInit</p>
              <p className="mt-1 font-semibold text-slate-700">{plugin.hasInit ? "✓ 已实现" : "—"}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-2">
              <p className="text-slate-400">onReady</p>
              <p className="mt-1 font-semibold text-slate-700">{plugin.hasReady ? "✓ 已实现" : "—"}</p>
            </div>
            <div className="rounded-md border border-slate-200 p-2">
              <p className="text-slate-400">onClose</p>
              <p className="mt-1 font-semibold text-slate-700">{plugin.hasClose ? "✓ 已实现" : "—"}</p>
            </div>
          </div>
          <p className="text-xs leading-5 text-slate-500">
            如需修改本插件的配置（开关、预设、字体、头像、消息语句等），请在「管理-插件配置」中启用插件后进入对应插件面板；配置变更会写入审计日志，并仅对当前租户生效。
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}