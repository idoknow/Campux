import { useEffect, useState } from "react";
import { PuzzleIcon, PowerIcon, PowerOffIcon, ActivityIcon, ShieldIcon, ShieldAlertIcon, ShieldCheckIcon, FileTextIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
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
        <PuzzleIcon className="size-5 text-slate-600" />
        <h2 className="text-base font-bold text-slate-900">已注册插件</h2>
        <Badge variant="secondary">{plugins.length}</Badge>
        {enabledCount < plugins.length ? (
          <span className="text-xs text-slate-400">
            ({enabledCount} 已启用)
          </span>
        ) : null}
      </div>

      {plugins.length === 0 ? (
        <EmptyCard title="暂无已注册的插件" />
      ) : (
        <div className="grid gap-3">
          {plugins.map((plugin) => (
            <div
              key={plugin.name}
              className={`rounded-lg border bg-white p-4 transition ${
                plugin.status === "disabled"
                  ? "border-slate-200 opacity-60"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-slate-900">
                    {plugin.name}
                  </h3>
                  {plugin.description ? (
                    <p className="mt-1 text-xs text-slate-500">{plugin.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
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
          ))}
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold text-slate-500">
          插件在服务端注册，通过事件系统与核心功能交互。禁用插件将在下次服务重启后生效（已禁用的插件不会执行生命周期钩子）。如需添加或移除插件，请修改服务端配置并重启服务。
        </p>
      </div>

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
            <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-slate-500">时间</th>
                    <th className="px-3 py-2 font-semibold text-slate-500">事件类型</th>
                    <th className="px-3 py-2 font-semibold text-slate-500">详情</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {eventLog.map((entry, index) => (
                    <tr key={index} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap font-mono">
                        {new Date(entry.timestamp).toLocaleTimeString("zh-CN")}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 font-mono font-semibold text-blue-700">
                          {entry.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatEventDetail(entry)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-slate-500">时间</th>
                    <th className="px-3 py-2 font-semibold text-slate-500">操作</th>
                    <th className="px-3 py-2 font-semibold text-slate-500">插件</th>
                    <th className="px-3 py-2 font-semibold text-slate-500">详情</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLog.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap font-mono">
                        {new Date(entry.timestamp).toLocaleTimeString("zh-CN")}
                      </td>
                      <td className="px-3 py-2">
                        <AuditActionBadge action={entry.action} />
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">
                        {entry.pluginName}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {entry.detail ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      {status === "enabled" ? "已启用" : "已禁用"}
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