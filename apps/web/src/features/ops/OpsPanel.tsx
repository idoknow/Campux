import { useEffect, useMemo, useState } from "react";
import { ActivityIcon, ArchiveIcon, Building2Icon, PauseCircleIcon, PlayCircleIcon, RefreshCwIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { SystemTenant, TenantStatus } from "@/types/app";
import { SectionHeader } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
  const [busyStatus, setBusyStatus] = useState<TenantStatus | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    const data = await api<{ tenants: SystemTenant[] }>("/api/system/tenants");
    setTenants(data.tenants);
    const nextTenant = data.tenants.find((tenant) => tenant.id === nextSelectedId) ?? data.tenants[0];
    setSelectedTenantId(nextTenant?.id ?? "");
  }

  useEffect(() => {
    void refreshTenants().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "无法读取租户列表");
    });
  }, []);

  async function updateStatus(status: TenantStatus) {
    if (!selectedTenant || selectedTenant.status === status) {
      return;
    }

    setBusyStatus(status);
    setError("");
    setNotice("");
    try {
      await api(`/api/system/tenants/${selectedTenant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refreshTenants(selectedTenant.id);
      setNotice(`已将 ${selectedTenant.name} 调整为${statusLabels[status]}。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "状态调整失败");
    } finally {
      setBusyStatus("");
    }
  }

  return (
    <div className="px-4 pb-6">
      <SectionHeader title="系统运维" subtitle="只处理租户生命周期和全局运行状态" action="刷新" icon={RefreshCwIcon} onAction={refreshTenants} />

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</p> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusSummary title="运行中" value={summary.active} tone="green" />
        <StatusSummary title="暂停" value={summary.paused} tone="amber" />
        <StatusSummary title="归档" value={summary.archived} tone="slate" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="rounded-md">
          <CardContent className="p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
              <Building2Icon className="size-4" />
              租户生命周期
            </div>
            <div className="flex flex-col gap-2">
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  className={`rounded-md border px-3 py-2 text-left transition ${selectedTenant?.id === tenant.id ? "border-sky-300 bg-sky-50" : "border-slate-100 bg-white hover:bg-slate-50"}`}
                  onClick={() => setSelectedTenantId(tenant.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{tenant.name}</span>
                    <Badge variant={tenant.status === "active" ? "secondary" : "outline"}>{statusLabels[tenant.status]}</Badge>
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{tenant.slug}</span>
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
                  <p className="text-xl font-black">{selectedTenant.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{selectedTenant.slug}</p>
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

              <p className="mt-4 text-sm text-slate-500">
                校园墙名称、slug、主题色、前台品牌名和公告由该租户的管理员在租户管理页维护。
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-md">
            <CardContent className="p-4 text-sm text-slate-500">暂无租户。</CardContent>
          </Card>
        )}
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
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-100 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}
