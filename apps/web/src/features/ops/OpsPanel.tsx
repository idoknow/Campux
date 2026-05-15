import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  ArchiveIcon,
  BotIcon,
  Building2Icon,
  CheckIcon,
  ClipboardListIcon,
  ClockIcon,
  FilterIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  SearchIcon,
  ShieldPlusIcon,
  UsersRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AuditLogItem, Pagination, SystemQueueSnapshot, SystemTenant, SystemUser, TenantRole, TenantStatus } from "@/types/app";
import { PaginationControls } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

const roleLabels: Record<TenantRole, string> = {
  submitter: "用户",
  reviewer: "审核员",
  admin: "管理员",
};

const lifecycleActions: Array<{ status: TenantStatus; label: string; icon: typeof PlayCircleIcon }> = [
  { status: "active", label: "恢复运行", icon: PlayCircleIcon },
  { status: "paused", label: "暂停租户", icon: PauseCircleIcon },
  { status: "archived", label: "归档租户", icon: ArchiveIcon },
];

type OpsTab = "users" | "audit";
type SystemUserRoleFilter = TenantRole | "system_operator";

const userRoleFilters: Array<{ value: SystemUserRoleFilter; label: string }> = [
  { value: "system_operator", label: "系统运维" },
  { value: "admin", label: "管理员" },
  { value: "reviewer", label: "审核员" },
  { value: "submitter", label: "用户" },
];

function defaultPagination(): Pagination {
  return {
    page: 1,
    limit: 10,
    total: 0,
    pageCount: 1,
  };
}

export function OpsPanel() {
  const [tenants, setTenants] = useState<SystemTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [usersPagination, setUsersPagination] = useState<Pagination>(() => defaultPagination());
  const [userPage, setUserPage] = useState(1);
  const [userKeyword, setUserKeyword] = useState("");
  const [userKeywordDraft, setUserKeywordDraft] = useState("");
  const [userTenantFilterId, setUserTenantFilterId] = useState("");
  const [selectedUserRoleFilters, setSelectedUserRoleFilters] = useState<SystemUserRoleFilter[]>([]);
  const [queue, setQueue] = useState<SystemQueueSnapshot | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditPagination, setAuditPagination] = useState<Pagination>(() => defaultPagination());
  const [auditPage, setAuditPage] = useState(1);
  const [activeOpsTab, setActiveOpsTab] = useState<OpsTab>("users");
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [assigningMembership, setAssigningMembership] = useState(false);
  const [membershipDialogUser, setMembershipDialogUser] = useState<SystemUser | null>(null);
  const [membershipForm, setMembershipForm] = useState<{ tenantId: string; role: TenantRole | "system_operator" }>({ tenantId: "", role: "submitter" });
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
      bots: tenants.reduce((sum, tenant) => sum + tenant.botAccountCount, 0),
    }),
    [tenants],
  );

  async function refreshOverview(nextSelectedId?: string) {
    setLoadingOverview(true);
    try {
      const [data, queueData] = await Promise.all([
        api<{ tenants: SystemTenant[] }>("/api/system/tenants"),
        api<SystemQueueSnapshot>("/api/system/queue"),
      ]);
      setTenants(data.tenants);
      setQueue(queueData);
      const nextTenant = data.tenants.find((tenant) => tenant.id === nextSelectedId) ?? data.tenants.find((tenant) => tenant.id === selectedTenantId) ?? data.tenants[0];
      setSelectedTenantId(nextTenant?.id ?? "");
    } finally {
      setLoadingOverview(false);
    }
  }

  async function refreshUsers(page = userPage) {
    setLoadingUsers(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(usersPagination.limit),
      });
      if (userTenantFilterId) {
        params.set("tenantId", userTenantFilterId);
      }
      if (selectedUserRoleFilters.length > 0) {
        params.set("roles", selectedUserRoleFilters.join(","));
      }
      if (userKeyword.trim()) {
        params.set("q", userKeyword.trim());
      }
      const data = await api<{ total: number; users: SystemUser[]; pagination: Pagination }>(`/api/system/users?${params}`);
      setUsers(data.users);
      setUsersPagination(data.pagination);
      setUserPage(data.pagination.page);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function refreshAudit(page = auditPage) {
    setLoadingAudit(true);
    try {
      const data = await api<{ logs: AuditLogItem[]; pagination: Pagination }>(`/api/system/audit-logs?page=${page}&limit=${auditPagination.limit}`);
      setAuditLogs(data.logs);
      setAuditPagination(data.pagination);
      setAuditPage(data.pagination.page);
    } finally {
      setLoadingAudit(false);
    }
  }

  async function refreshAll() {
    await Promise.all([refreshOverview(), refreshUsers(userPage), refreshAudit(auditPage)]);
  }

  useEffect(() => {
    void refreshAll().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取运维面板数据");
    });
  }, []);

  useEffect(() => {
    void refreshUsers(userPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取全局用户");
    });
  }, [userPage, userKeyword, userTenantFilterId, selectedUserRoleFilters]);

  useEffect(() => {
    void refreshAudit(auditPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取审计日志");
    });
  }, [auditPage]);

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
      await refreshOverview(selectedTenant.id);
      await refreshAudit(1);
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
      await Promise.all([refreshOverview(created?.id), refreshUsers(userPage), refreshAudit(1)]);
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
      await refreshOverview(selectedTenant.id);
      await refreshAudit(1);
      toast.success(hostDraft.trim() ? "入口 host 已更新。" : "入口 host 已清空。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "host 更新失败");
    } finally {
      setSavingHost(false);
    }
  }

  function toggleUserRoleFilter(role: SystemUserRoleFilter) {
    setSelectedUserRoleFilters((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]));
    setUserPage(1);
  }

  function changeUserTenantFilter(tenantId: string) {
    setUserTenantFilterId(tenantId === "all" ? "" : tenantId);
    setSelectedUserRoleFilters([]);
    setUserPage(1);
  }

  function openMembershipDialog(user: SystemUser) {
    const firstTenant = tenants.find((tenant) => tenant.status === "active") ?? tenants[0];
    setMembershipDialogUser(user);
    setMembershipForm({ tenantId: firstTenant?.id ?? "", role: "submitter" });
  }

  async function assignMembership() {
    if (!membershipDialogUser || (membershipForm.role !== "system_operator" && !membershipForm.tenantId)) {
      return;
    }

    setAssigningMembership(true);
    try {
      await api(`/api/system/users/${membershipDialogUser.id}/memberships`, {
        method: "POST",
        body: JSON.stringify({
          role: membershipForm.role,
          ...(membershipForm.role === "system_operator" ? {} : { tenantId: membershipForm.tenantId }),
        }),
      });
      toast.success(membershipForm.role === "system_operator" ? "系统运维身份已添加。" : "用户身份已更新。");
      setMembershipDialogUser(null);
      await Promise.all([refreshUsers(userPage), refreshOverview(selectedTenantId), refreshAudit(1)]);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "添加身份失败");
    } finally {
      setAssigningMembership(false);
    }
  }

  return (
    <div className="px-4 pb-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={loadingOverview || loadingUsers || loadingAudit} onClick={() => void refreshAll()}>
          刷新
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <StatusSummary title="运行中" value={summary.active} tone="green" />
        <StatusSummary title="暂停" value={summary.paused} tone="amber" />
        <StatusSummary title="归档" value={summary.archived} tone="slate" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <MetricCard title="全局用户" value={usersPagination.total} icon={UsersRoundIcon} accent="blue" />
        <MetricCard title="Bot 账号" value={summary.bots} icon={BotIcon} accent="violet" />
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
              {loadingOverview ? <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" /> : null}
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
                  <span className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold text-slate-500">
                    <span>{tenant.memberCount} 用户</span>
                    <span>{tenant.botAccountCount} 墙号</span>
                    <span>{tenant.postCount} 稿件</span>
                  </span>
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

              <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 font-bold">
                  <BotIcon className="size-4" />
                  Bot 与发布目标
                  <span className="ml-auto text-xs font-bold text-slate-400">{selectedTenant.bots.length} 个墙号</span>
                </div>
                <div className="mt-3 grid gap-2">
                  {selectedTenant.bots.length > 0 ? (
                    selectedTenant.bots.map((bot) => <TenantBotCard key={bot.id} bot={bot} />)
                  ) : (
                    <p className="rounded-md bg-slate-50 px-3 py-4 text-sm font-bold text-slate-500">当前租户还没有配置 Bot。</p>
                  )}
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

      <Card className="mt-4 rounded-md">
        <CardContent className="p-4">
          <Tabs value={activeOpsTab} onValueChange={(value) => setActiveOpsTab(value as OpsTab)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TabsList className="h-10">
                <TabsTrigger value="users" className="h-8 px-3">
                  <UsersRoundIcon className="size-4" />
                  全局用户
                </TabsTrigger>
                <TabsTrigger value="audit" className="h-8 px-3">
                  <ClipboardListIcon className="size-4" />
                  审计日志
                </TabsTrigger>
              </TabsList>
              <Button
                variant="outline"
                size="sm"
                disabled={activeOpsTab === "users" ? loadingUsers : loadingAudit}
                onClick={() => void (activeOpsTab === "users" ? refreshUsers(userPage) : refreshAudit(auditPage))}
              >
                刷新当前页
              </Button>
            </div>

            <TabsContent value="users" className="mt-4">
              <GlobalUsersTable
                users={users}
                loading={loadingUsers}
                pagination={usersPagination}
                keyword={userKeywordDraft}
                selectedRoleFilters={selectedUserRoleFilters}
                selectedTenantFilterId={userTenantFilterId}
                tenants={tenants}
                onKeywordChange={setUserKeywordDraft}
                onKeywordSearch={() => {
                  setUserKeyword(userKeywordDraft);
                  setUserPage(1);
                }}
                onKeywordClear={() => {
                  setUserKeywordDraft("");
                  setUserKeyword("");
                  setUserPage(1);
                }}
                onClearRoleFilters={() => {
                  setSelectedUserRoleFilters([]);
                  setUserPage(1);
                }}
                onTenantFilterChange={changeUserTenantFilter}
                onOpenAssignMembership={openMembershipDialog}
                onPageChange={setUserPage}
                onToggleRoleFilter={toggleUserRoleFilter}
              />
            </TabsContent>

            <TabsContent value="audit" className="mt-4">
              <AuditLogTable logs={auditLogs} loading={loadingAudit} pagination={auditPagination} onPageChange={setAuditPage} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={Boolean(membershipDialogUser)} onOpenChange={(open) => !open && setMembershipDialogUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加租户身份</DialogTitle>
            <DialogDescription>
              给 {membershipDialogUser?.displayName ?? membershipDialogUser?.qqUin ?? "用户"} 添加系统运维身份，或添加/更新某个校园墙内的身份。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-5">
            <label className="text-sm font-semibold text-slate-700">
              校园墙
              <Select value={membershipForm.tenantId} onValueChange={(tenantId) => setMembershipForm({ ...membershipForm, tenantId })}>
                <SelectTrigger className="mt-1 w-full bg-white" disabled={membershipForm.role === "system_operator"}>
                  <SelectValue placeholder="选择校园墙" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name} · {statusLabels[tenant.status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              身份
              <Select value={membershipForm.role} onValueChange={(role) => setMembershipForm({ ...membershipForm, role: role as TenantRole | "system_operator" })}>
                <SelectTrigger className="mt-1 w-full bg-white">
                  <SelectValue placeholder="选择身份" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system_operator">系统运维（全局）</SelectItem>
                  <SelectItem value="submitter">用户</SelectItem>
                  <SelectItem value="reviewer">审核员</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              系统运维是全局身份，不需要选择校园墙；租户身份如果已存在，保存后会直接更新。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={assigningMembership} onClick={() => setMembershipDialogUser(null)}>
              取消
            </Button>
            <Button disabled={assigningMembership || (membershipForm.role !== "system_operator" && !membershipForm.tenantId)} onClick={() => void assignMembership()}>
              <ShieldPlusIcon data-icon="inline-start" />
              保存身份
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TenantBotCard({ bot }: { bot: SystemTenant["bots"][number] }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{bot.displayName}</p>
          <p className="mt-0.5 text-xs font-bold text-slate-500">QQ {bot.qqUin}</p>
        </div>
        <Badge variant={bot.enabled ? "secondary" : "outline"}>{bot.enabled ? "启用" : "停用"}</Badge>
      </div>
      <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
        <span>审核群：{bot.reviewGroupId ?? "未配置"}</span>
        <span>最近连接：{formatDateTime(bot.lastSeenAt)}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {bot.publishTargets.length > 0 ? (
          bot.publishTargets.map((target) => (
            <Badge key={target.id} variant={target.enabled ? "outline" : "secondary"} className="gap-1">
              {target.displayName}
              {target.required ? " · 必发" : ""}
              {!target.enabled ? " · 停用" : ""}
            </Badge>
          ))
        ) : (
          <span className="text-xs font-bold text-slate-400">没有发布目标</span>
        )}
      </div>
    </div>
  );
}

function GlobalUsersTable({
  users,
  loading,
  pagination,
  keyword,
  selectedRoleFilters,
  selectedTenantFilterId,
  tenants,
  onKeywordChange,
  onKeywordClear,
  onKeywordSearch,
  onClearRoleFilters,
  onTenantFilterChange,
  onOpenAssignMembership,
  onPageChange,
  onToggleRoleFilter,
}: {
  users: SystemUser[];
  loading: boolean;
  pagination: Pagination;
  keyword: string;
  selectedRoleFilters: SystemUserRoleFilter[];
  selectedTenantFilterId: string;
  tenants: SystemTenant[];
  onKeywordChange: (keyword: string) => void;
  onKeywordClear: () => void;
  onKeywordSearch: () => void;
  onClearRoleFilters: () => void;
  onTenantFilterChange: (tenantId: string) => void;
  onOpenAssignMembership: (user: SystemUser) => void;
  onPageChange: (page: number) => void;
  onToggleRoleFilter: (role: SystemUserRoleFilter) => void;
}) {
  if (loading && users.length === 0) {
    return <InlineLoading title="正在加载全局用户..." />;
  }

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2">
          <SearchIcon className="size-4 shrink-0 text-slate-400" />
          <Input
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            placeholder="按 QQ 号或昵称搜索账号"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onKeywordSearch();
              }
            }}
          />
        </div>
        {keyword ? (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onKeywordClear}>
            清除搜索
          </Button>
        ) : null}
        <Button variant="outline" size="sm" className="shrink-0" onClick={onKeywordSearch}>
          搜索
        </Button>
      </div>
      <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <FilterIcon className="size-4" />
            按租户身份筛选
          </div>
          {selectedRoleFilters.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearRoleFilters}>
              清除筛选
            </Button>
          ) : null}
        </div>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selectedTenantFilterId || "all"} onValueChange={onTenantFilterChange}>
            <SelectTrigger className="w-full bg-white sm:w-72">
              <SelectValue placeholder="选择校园墙" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部用户</SelectItem>
              {tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs font-semibold text-slate-500">
            {selectedTenantFilterId ? "筛选该校园墙内的具体身份，也可叠加系统运维" : "可直接筛选系统运维；选择校园墙后可筛选租户身份"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {userRoleFilters.map((filter) => {
            const active = selectedRoleFilters.includes(filter.value);
            return (
              <Button
                key={filter.value}
                type="button"
                variant={active ? "secondary" : "outline"}
                disabled={!selectedTenantFilterId && filter.value !== "system_operator"}
                size="sm"
                className={active ? "h-8 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50" : "h-8 bg-white"}
                onClick={() => onToggleRoleFilter(filter.value)}
              >
                {active ? <CheckIcon data-icon="inline-start" /> : null}
                {filter.label}
              </Button>
            );
          })}
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200">
        {users.map((user) => (
          <div key={user.id} className="grid gap-3 border-b border-slate-100 bg-white p-3 last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(150px,0.6fr)]">
            <div className="flex min-w-0 items-center gap-3">
              <img className="size-10 rounded-full border border-slate-200 bg-slate-50" src={`https://q1.qlogo.cn/g?b=qq&nk=${user.qqUin}&s=100`} alt="" loading="lazy" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{user.displayName ?? "未设置昵称"}</p>
                <p className="mt-0.5 text-xs font-bold text-slate-500">QQ {user.qqUin}</p>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5">
                {user.systemRole === "system_operator" ? <Badge variant="secondary">系统运维</Badge> : null}
                {user.isTestAccount ? <Badge variant="outline">测试账号</Badge> : null}
                {user.memberships.length === 0 ? <Badge variant="outline">未加入租户</Badge> : null}
                {user.memberships.slice(0, 4).map((membership) => (
                  <Badge key={membership.id} variant="outline">
                    {membership.tenant.name} · {roleLabels[membership.role]}
                  </Badge>
                ))}
                {user.memberships.length > 4 ? <Badge variant="outline">+{user.memberships.length - 4}</Badge> : null}
              </div>
            </div>
            <div className="text-xs text-slate-500">
              <p>创建：{formatDateTime(user.createdAt)}</p>
              <p className="mt-1">加入：{user.memberships.length} 个校园墙</p>
              <Button variant="outline" size="sm" className="mt-2 h-7 px-2 text-xs" disabled={tenants.length === 0} onClick={() => onOpenAssignMembership(user)}>
                <ShieldPlusIcon data-icon="inline-start" />
                添加身份
              </Button>
            </div>
          </div>
        ))}
      </div>
      {users.length === 0 ? <p className="px-3 py-8 text-center text-sm font-bold text-slate-500">没有用户。</p> : null}
      <PaginationControls pagination={pagination} busy={loading} onPageChange={onPageChange} />
    </div>
  );
}

function AuditLogTable({
  logs,
  loading,
  pagination,
  onPageChange,
}: {
  logs: AuditLogItem[];
  loading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
}) {
  if (loading && logs.length === 0) {
    return <InlineLoading title="正在加载审计日志..." />;
  }

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-slate-200">
        {logs.map((log) => (
          <div key={log.id} className="grid gap-3 border-b border-slate-100 bg-white p-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(160px,0.7fr)]">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{log.action}</p>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {log.targetType}
                {log.targetId ? ` · ${log.targetId}` : ""}
              </p>
            </div>
            <div className="min-w-0 text-xs text-slate-500">
              <p>
                租户：<span className="font-semibold text-slate-700">{log.tenant?.name ?? "全局"}</span>
              </p>
              <p className="mt-1">
                操作人：<span className="font-semibold text-slate-700">{log.actor?.displayName ?? log.actor?.qqUin ?? "系统"}</span>
              </p>
              <p className="mt-1 truncate">详情：{formatDetail(log.detail)}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ClockIcon className="size-4" />
              {formatDateTime(log.createdAt)}
            </div>
          </div>
        ))}
      </div>
      {logs.length === 0 ? <p className="px-3 py-8 text-center text-sm font-bold text-slate-500">没有审计日志。</p> : null}
      <PaginationControls pagination={pagination} busy={loading} onPageChange={onPageChange} />
    </div>
  );
}

function InlineLoading({ title }: { title: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center gap-3 text-sm font-bold text-slate-500">
      <span className="size-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
      {title}
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

function formatDateTime(value: string | null) {
  if (!value) {
    return "暂无";
  }
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDetail(detail: unknown) {
  if (!detail) {
    return "无";
  }
  if (typeof detail === "string") {
    return detail;
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return "无法显示";
  }
}
