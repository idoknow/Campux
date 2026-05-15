import { useEffect, useMemo, useState } from "react";
import { ActivityIcon, ArchiveIcon, BotIcon, Building2Icon, ClipboardListIcon, PauseCircleIcon, PlayCircleIcon, PlusIcon, UsersRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AuditLogItem, SystemBot, SystemQueueSnapshot, SystemTenant, SystemUser, TenantStatus } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const statusLabels: Record<TenantStatus, string> = {
  active: "运行中",
  paused: "暂停",
  archived: "归档",
};

const statusDescriptions: Record<TenantStatus, string> = {
  active: "允许用户进入并正常处理投稿。",
  paused: "临时暂停运营，保留数据和配置。",
  archived: "归档历史租户，默认不再出现在用户入口。",
};

const lifecycleActions: Array<{ status: TenantStatus; label: string; icon: typeof PlayCircleIcon }> = [
  { status: "active", label: "恢复运行", icon: PlayCircleIcon },
  { status: "paused", label: "暂停租户", icon: PauseCircleIcon },
  { status: "archived", label: "归档租户", icon: ArchiveIcon },
];

export function OpsPanel() {
  const [tenants, setTenants] = useState<SystemTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [bots, setBots] = useState<SystemBot[]>([]);
  const [queue, setQueue] = useState<SystemQueueSnapshot | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [busyStatus, setBusyStatus] = useState<TenantStatus | "">("");
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [savingHost, setSavingHost] = useState(false);
  const [hostDraft, setHostDraft] = useState("");
  const [tenantForm, setTenantForm] = useState({
    name: "",
    slug: "",
    host: "",
    themeColor: "#111827",
    botQqUin: "",
  });

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0],
    [selectedTenantId, tenants],
  );

  const summary = useMemo(
    () => ({
      active: tenants.filter((tenant) => tenant.status === "active").length,
      paused: tenants.filter((tenant) => tenant.status === "paused").length,
      archived: tenants.filter((tenant) => tenant.status === "archived").length,
    }),
    [tenants],
  );

  async function refreshTenants(nextSelectedId?: string) {
    const [data, userData, botData, queueData, auditData] = await Promise.all([
      api<{ tenants: SystemTenant[] }>("/api/system/tenants"),
      api<{ total: number; users: SystemUser[] }>("/api/system/users"),
      api<{ bots: SystemBot[] }>("/api/system/bots"),
      api<SystemQueueSnapshot>("/api/system/queue"),
      api<{ logs: AuditLogItem[] }>("/api/system/audit-logs"),
    ]);
    setTenants(data.tenants);
    setUsers(userData.users);
    setUserTotal(userData.total);
    setBots(botData.bots);
    setQueue(queueData);
    setAuditLogs(auditData.logs);
    const nextTenant = data.tenants.find((tenant) => tenant.id === nextSelectedId) ?? data.tenants[0];
    setSelectedTenantId(nextTenant?.id ?? "");
  }

  useEffect(() => {
    void refreshTenants().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取租户列表");
    });
  }, []);

  useEffect(() => {
    setHostDraft(selectedTenant?.host ?? "");
  }, [selectedTenant?.id, selectedTenant?.host]);

  async function updateStatus(status: TenantStatus) {
    if (!selectedTenant || selectedTenant.status === status) {
      return;
    }

    setBusyStatus(status);
    try {
      await api(`/api/system/tenants/${selectedTenant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refreshTenants(selectedTenant.id);
      toast.success(`已将 ${selectedTenant.name} 调整为${statusLabels[status]}。`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "状态调整失败");
    } finally {
      setBusyStatus("");
    }
  }

  async function createTenant() {
    setCreatingTenant(true);
    try {
      const data = await api<{ tenants: SystemTenant[] }>("/api/system/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: tenantForm.name.trim(),
          slug: tenantForm.slug.trim(),
          host: tenantForm.host.trim() || null,
          themeColor: tenantForm.themeColor,
          ...(tenantForm.botQqUin.trim().length > 0 ? { botQqUin: tenantForm.botQqUin.trim() } : {}),
        }),
      });
      setTenants(data.tenants);
      const created = data.tenants.find((tenant) => tenant.slug === tenantForm.slug.trim());
      setSelectedTenantId(created?.id ?? data.tenants[0]?.id ?? "");
      setTenantForm({ name: "", slug: "", host: "", themeColor: "#111827", botQqUin: "" });
      toast.success("新校园墙已创建。");
      await refreshTenants(created?.id);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "创建租户失败");
    } finally {
      setCreatingTenant(false);
    }
  }

  async function saveHost() {
    if (!selectedTenant) {
      return;
    }

    setSavingHost(true);
    try {
      await api(`/api/system/tenants/${selectedTenant.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          host: hostDraft.trim() || null,
        }),
      });
      await refreshTenants(selectedTenant.id);
      toast.success(hostDraft.trim() ? "入口 host 已更新。" : "入口 host 已清空。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "host 更新失败");
    } finally {
      setSavingHost(false);
    }
  }

  return (
    <div className="px-4 pb-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void refreshTenants()}>
          刷新
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusSummary title="运行中" value={summary.active} tone="green" />
        <StatusSummary title="暂停" value={summary.paused} tone="amber" />
        <StatusSummary title="归档" value={summary.archived} tone="slate" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <MetricCard title="全局用户" value={userTotal} icon={UsersRoundIcon} accent="blue" />
        <MetricCard title="Bot 账号" value={bots.length} icon={BotIcon} accent="violet" />
        <MetricCard title="队列中" value={queue?.runtime.queued ?? 0} icon={ActivityIcon} accent="amber" />
        <MetricCard title="发布失败" value={queue?.publishAttempts.failed ?? 0} icon={ClipboardListIcon} accent="rose" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="rounded-md">
          <CardContent className="p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Building2Icon className="size-4" />
                租户生命周期
              </div>
            </div>
            <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <PlusIcon className="size-4" />
                添加租户
              </div>
              <div className="grid gap-2">
                <Input placeholder="校园墙名称" value={tenantForm.name} onChange={(event) => setTenantForm({ ...tenantForm, name: event.target.value })} />
                <Input placeholder="slug，例如 canton-wall" value={tenantForm.slug} onChange={(event) => setTenantForm({ ...tenantForm, slug: event.target.value })} />
                <Input placeholder="专属 host，可选" value={tenantForm.host} onChange={(event) => setTenantForm({ ...tenantForm, host: event.target.value })} />
                <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
                  <span className="h-9 rounded-md border border-slate-200" style={{ backgroundColor: tenantForm.themeColor }} />
                  <Input value={tenantForm.themeColor} onChange={(event) => setTenantForm({ ...tenantForm, themeColor: event.target.value })} />
                </div>
                <Input placeholder="Bot QQ，可选" value={tenantForm.botQqUin} onChange={(event) => setTenantForm({ ...tenantForm, botQqUin: event.target.value })} />
                <Button className="font-medium" disabled={creatingTenant || tenantForm.name.trim().length === 0 || tenantForm.slug.trim().length === 0} onClick={() => void createTenant()}>
                  <PlusIcon data-icon="inline-start" />
                  创建
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  className={`rounded-md border px-3 py-2 text-left transition ${selectedTenant?.id === tenant.id ? "border-slate-300 bg-slate-100" : "border-slate-100 bg-white hover:bg-slate-50"}`}
                  onClick={() => setSelectedTenantId(tenant.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{tenant.name}</span>
                    <Badge variant={tenant.status === "active" ? "secondary" : "outline"}>{statusLabels[tenant.status]}</Badge>
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{tenant.slug}</span>
                  {tenant.host ? <span className="mt-1 block truncate text-xs font-semibold text-slate-500">{tenant.host}</span> : null}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {selectedTenant ? (
          <Card className="rounded-md">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{selectedTenant.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{selectedTenant.slug}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{selectedTenant.host ?? "未绑定专属 host"}</p>
                </div>
                <Badge variant={selectedTenant.status === "active" ? "secondary" : "outline"}>{statusLabels[selectedTenant.status]}</Badge>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Metric label="成员" value={selectedTenant.memberCount} />
                <Metric label="墙号" value={selectedTenant.botAccountCount} />
                <Metric label="稿件" value={selectedTenant.postCount} />
              </div>

              <div className="mt-4 rounded-md bg-slate-50 p-3">
                <div className="flex items-center gap-2 font-bold">
                  <ActivityIcon className="size-4" />
                  生命周期状态
                </div>
                <p className="mt-1 text-sm text-slate-500">{statusDescriptions[selectedTenant.status]}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {lifecycleActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <Button
                        key={action.status}
                        variant={selectedTenant.status === action.status ? "secondary" : "outline"}
                        disabled={selectedTenant.status === action.status || busyStatus === action.status}
                        onClick={() => void updateStatus(action.status)}
                      >
                        <Icon data-icon="inline-start" />
                        {action.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 rounded-md bg-slate-50 p-3">
                <div className="flex items-center gap-2 font-bold">
                  <Building2Icon className="size-4" />
                  专属访问 host
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  设置后，从这个域名进入的用户会被固定到当前校园墙，不再展示租户选择。
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input placeholder="wall.example.com 或 localhost:5180" value={hostDraft} onChange={(event) => setHostDraft(event.target.value)} />
                  <Button className="shrink-0 font-medium" disabled={savingHost} onClick={() => void saveHost()}>
                    保存 host
                  </Button>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-500">
                校园墙名称、slug、主题色、前台品牌名和公告由该租户的管理员在租户管理页维护；专属 host 由系统运维统一管理。
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-md">
            <CardContent className="p-4 text-sm text-slate-500">暂无租户。</CardContent>
          </Card>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <UsersRoundIcon className="size-4" />
              全局用户
              <span className="ml-auto text-xs font-bold text-slate-400">最近 {users.length} 条</span>
            </div>
            <div className="flex max-h-80 flex-col gap-2 overflow-auto">
              {users.slice(0, 12).map((user) => (
                <div key={user.id} className="rounded-md bg-slate-50 p-2">
                  <p className="truncate text-sm font-semibold">{user.displayName ?? user.qqUin}</p>
                  <p className="text-xs text-slate-500">
                    {user.memberships.length} 个校园墙{user.systemRole ? " · 系统运维" : ""}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <BotIcon className="size-4" />
              Bot 与发布目标
            </div>
            <div className="flex max-h-80 flex-col gap-2 overflow-auto">
              {bots.slice(0, 12).map((bot) => (
                <div key={bot.id} className="rounded-md bg-slate-50 p-2">
                  <p className="truncate text-sm font-semibold">{bot.displayName}</p>
                  <p className="text-xs text-slate-500">{bot.tenant.name} · {bot.publishTargets.length} 个发布目标</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <ActivityIcon className="size-4" />
              审计日志
            </div>
            <div className="flex max-h-80 flex-col gap-2 overflow-auto">
              {auditLogs.slice(0, 12).map((log) => (
                <div key={log.id} className="rounded-md bg-slate-50 p-2">
                  <p className="truncate text-sm font-semibold">{log.action}</p>
                  <p className="text-xs text-slate-500">{log.tenant?.name ?? "全局"} · {log.actor?.displayName ?? log.actor?.qqUin ?? "系统"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusSummary({ title, value, tone }: { title: string; value: number; tone: "green" | "amber" | "slate" }) {
  const toneClass = {
    green: "bg-green-50 text-green-800",
    amber: "bg-amber-50 text-amber-800",
    slate: "bg-slate-100 text-slate-700",
  }[tone];

  return (
    <div className={`rounded-md px-4 py-3 ${toneClass}`}>
      <p className="text-sm font-bold">{title}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-100 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, accent }: { title: string; value: number; icon: typeof ActivityIcon; accent: "blue" | "violet" | "amber" | "rose" }) {
  const accentClass = {
    blue: "product-accent-blue",
    violet: "product-accent-violet",
    amber: "product-accent-amber",
    rose: "product-accent-rose",
  }[accent];

  return (
    <div className={`rounded-md border px-4 py-3 ${accentClass}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4" />
        {title}
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
