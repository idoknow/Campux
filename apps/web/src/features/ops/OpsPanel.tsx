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
  Globe2Icon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldPlusIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { readListPreferences, writeListPreferences } from "@/lib/list-preferences";
import type { AuditLogItem, Pagination, SystemQueueSnapshot, SystemRole, SystemTenant, SystemUser, TenantRole, TenantStatus } from "@/types/app";
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
type OpsPanelMode = "system" | "operations";
type SystemUserRoleFilter = TenantRole | SystemRole;
type OpsUserListPreferences = {
  keyword: string;
  tenantFilterId: string;
  roleFilters: SystemUserRoleFilter[];
};

const userRoleFilters: Array<{ value: SystemUserRoleFilter; label: string }> = [
  { value: "operations_admin", label: "运营管理员" },
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

function opsUserPreferencesKey(mode: OpsPanelMode) {
  return `ops.${mode}.users`;
}

function isSystemUserRoleFilter(value: unknown): value is SystemUserRoleFilter {
  return value === "submitter"
    || value === "reviewer"
    || value === "admin"
    || value === "operations_admin"
    || value === "system_operator";
}

function isOpsUserListPreferences(value: unknown): value is OpsUserListPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OpsUserListPreferences>;
  return typeof candidate.keyword === "string"
    && typeof candidate.tenantFilterId === "string"
    && Array.isArray(candidate.roleFilters)
    && candidate.roleFilters.every(isSystemUserRoleFilter);
}

function normalizeOpsUserPreferences(mode: OpsPanelMode, preferences: OpsUserListPreferences): OpsUserListPreferences {
  return {
    keyword: preferences.keyword,
    tenantFilterId: preferences.tenantFilterId,
    roleFilters: preferences.roleFilters.filter((role) => mode === "system" || (role !== "system_operator" && role !== "operations_admin")),
  };
}

function readOpsUserListPreferences(mode: OpsPanelMode): OpsUserListPreferences {
  const fallback: OpsUserListPreferences = { keyword: "", tenantFilterId: "", roleFilters: [] };
  return normalizeOpsUserPreferences(
    mode,
    readListPreferences(opsUserPreferencesKey(mode), fallback, isOpsUserListPreferences),
  );
}

function writeOpsUserListPreferences(mode: OpsPanelMode, preferences: OpsUserListPreferences) {
  writeListPreferences(opsUserPreferencesKey(mode), normalizeOpsUserPreferences(mode, preferences));
}

const tenantSlugMinLength = 4;
const tenantSlugMaxLength = 16;
const tenantSlugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// Operators shouldn't have to invent a URL slug. We generate a valid 4-16 char
// candidate (matches the backend ^[a-z0-9][a-z0-9-]*[a-z0-9]$ rule).
function generateWallSlug(existingSlugs: ReadonlySet<string> = new Set()) {
  for (let index = 0; index < 20; index += 1) {
    const candidate = `wall-${Math.random().toString(36).slice(2, 8)}`;
    if (!existingSlugs.has(candidate)) {
      return candidate;
    }
  }
  return `wall-${Date.now().toString(36)}`;
}

function createTenantFormState(existingSlugs?: ReadonlySet<string>) {
  return {
    name: "",
    slug: generateWallSlug(existingSlugs),
    host: "",
    themeColor: "#111827",
    botQqUin: "",
  };
}

export function OpsPanel({
  mode = "system",
  onTenantCreated,
  onEnterTenant,
}: {
  mode?: OpsPanelMode;
  onTenantCreated?: (() => Promise<void>) | undefined;
  onEnterTenant?: ((tenantId: string) => Promise<void>) | undefined;
}) {
  const isSystemMode = mode === "system";
  const [tenants, setTenants] = useState<SystemTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [operationsAdmins, setOperationsAdmins] = useState<SystemUser[]>([]);
  const [usersPagination, setUsersPagination] = useState<Pagination>(() => defaultPagination());
  const [userPage, setUserPage] = useState(1);
  const [userKeyword, setUserKeyword] = useState(() => readOpsUserListPreferences(mode).keyword);
  const [userKeywordDraft, setUserKeywordDraft] = useState(() => readOpsUserListPreferences(mode).keyword);
  const [userTenantFilterId, setUserTenantFilterId] = useState(() => readOpsUserListPreferences(mode).tenantFilterId);
  const [selectedUserRoleFilters, setSelectedUserRoleFilters] = useState<SystemUserRoleFilter[]>(() => readOpsUserListPreferences(mode).roleFilters);
  const [queue, setQueue] = useState<SystemQueueSnapshot | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditPagination, setAuditPagination] = useState<Pagination>(() => defaultPagination());
  const [auditPage, setAuditPage] = useState(1);
  const [activeOpsTab, setActiveOpsTab] = useState<OpsTab>("users");
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingOperationsAdmins, setLoadingOperationsAdmins] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [assigningMembership, setAssigningMembership] = useState(false);
  const [accessBusyKey, setAccessBusyKey] = useState("");
  const [grantTenantByUserId, setGrantTenantByUserId] = useState<Record<string, string>>({});
  const [membershipDialogUser, setMembershipDialogUser] = useState<SystemUser | null>(null);
  const [membershipForm, setMembershipForm] = useState<{ tenantId: string; role: TenantRole | SystemRole }>({ tenantId: "", role: "submitter" });
  const [busyStatus, setBusyStatus] = useState<TenantStatus | "">("");
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [enteringTenantId, setEnteringTenantId] = useState("");
  const [savingHost, setSavingHost] = useState(false);
  const [savingManagementHost, setSavingManagementHost] = useState(false);
  const [hostDraft, setHostDraft] = useState("");
  const [managementHostDraft, setManagementHostDraft] = useState("");
  const [tenantDomainSuffix, setTenantDomainSuffix] = useState<string | null>(null);
  const [tenantForm, setTenantForm] = useState(() => createTenantFormState());

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0],
    [selectedTenantId, tenants],
  );

  const availableRoleFilters = useMemo(
    () => (isSystemMode ? userRoleFilters : userRoleFilters.filter((filter) => filter.value !== "system_operator" && filter.value !== "operations_admin")),
    [isSystemMode],
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

  const existingTenantSlugs = useMemo(() => new Set(tenants.map((tenant) => tenant.slug)), [tenants]);
  const existingTenantHosts = useMemo(() => new Set(tenants.map((tenant) => tenant.host).filter((host): host is string => Boolean(host))), [tenants]);

  const tenantFormSlug = tenantForm.slug.trim();
  const tenantFormHost = tenantForm.host.trim();
  const expectedTenantHost = tenantFormHost || (tenantDomainSuffix && tenantFormSlug ? `${tenantFormSlug}.${tenantDomainSuffix}` : "");
  const slugLengthInvalid = tenantFormSlug.length > 0 && (tenantFormSlug.length < tenantSlugMinLength || tenantFormSlug.length > tenantSlugMaxLength);
  const slugFormatInvalid = tenantFormSlug.length > 0 && !tenantSlugPattern.test(tenantFormSlug);
  const slugAlreadyUsed = tenantFormSlug.length > 0 && existingTenantSlugs.has(tenantFormSlug);
  const expectedHostAlreadyUsed = expectedTenantHost.length > 0 && existingTenantHosts.has(expectedTenantHost);
  const tenantFormInvalid = slugLengthInvalid || slugFormatInvalid || slugAlreadyUsed || expectedHostAlreadyUsed;
  const tenantSlugHint = tenantFormHost
    ? "访问标识用于 URL 和内部标识，创建后不可修改。"
    : tenantDomainSuffix
      ? "访问标识会作为专属子域名前缀，创建后不可修改。"
      : "访问标识用于 URL 和内部标识，创建后不可修改。";
  const expectedTenantHostLabel = tenantFormHost ? "专属访问域名" : "预计访问域名";

  async function refreshOverview(nextSelectedId?: string) {
    setLoadingOverview(true);
    try {
      const [data, queueData] = await Promise.all([
        api<{ tenants: SystemTenant[]; tenantDomainSuffix?: string | null }>("/api/system/tenants"),
        api<SystemQueueSnapshot>("/api/system/queue"),
      ]);
      setTenants(data.tenants);
      setTenantDomainSuffix(data.tenantDomainSuffix ?? null);
      setQueue(queueData);
      const nextTenant = data.tenants.find((tenant) => tenant.id === nextSelectedId) ?? data.tenants.find((tenant) => tenant.id === selectedTenantId) ?? data.tenants[0];
      setSelectedTenantId(nextTenant?.id ?? "");
    } finally {
      setLoadingOverview(false);
    }
  }

  async function refreshSettings() {
    if (!isSystemMode) {
      setManagementHostDraft("");
      return;
    }

    setLoadingSettings(true);
    try {
      const data = await api<{ managementHost: string | null }>("/api/system/settings");
      setManagementHostDraft(data.managementHost ?? "");
    } finally {
      setLoadingSettings(false);
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

  async function refreshOperationsAdmins() {
    if (!isSystemMode) {
      setOperationsAdmins([]);
      return;
    }

    setLoadingOperationsAdmins(true);
    try {
      const data = await api<{ users: SystemUser[] }>("/api/system/users?roles=operations_admin&page=1&limit=50");
      setOperationsAdmins(data.users);
    } finally {
      setLoadingOperationsAdmins(false);
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
    await Promise.all([refreshOverview(), refreshSettings(), refreshUsers(userPage), refreshOperationsAdmins(), refreshAudit(auditPage)]);
  }

  useEffect(() => {
    void refreshAll().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取运维面板数据");
    });
  }, []);

  useEffect(() => {
    const preferences = readOpsUserListPreferences(mode);
    setUserKeyword(preferences.keyword);
    setUserKeywordDraft(preferences.keyword);
    setUserTenantFilterId(preferences.tenantFilterId);
    setSelectedUserRoleFilters(preferences.roleFilters);
    setUserPage(1);
  }, [mode]);

  useEffect(() => {
    void refreshUsers(userPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取全局用户");
    });
  }, [userPage, userKeyword, userTenantFilterId, selectedUserRoleFilters]);

  useEffect(() => {
    if (!userTenantFilterId || tenants.length === 0 || tenants.some((tenant) => tenant.id === userTenantFilterId)) {
      return;
    }
    setUserTenantFilterId("");
    setSelectedUserRoleFilters([]);
    writeOpsUserListPreferences(mode, { keyword: userKeyword, tenantFilterId: "", roleFilters: [] });
    setUserPage(1);
  }, [mode, tenants, userKeyword, userTenantFilterId]);

  useEffect(() => {
    void refreshAudit(auditPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取审计日志");
    });
  }, [auditPage]);

  useEffect(() => {
    setHostDraft(selectedTenant?.host ?? "");
  }, [selectedTenant?.id, selectedTenant?.host]);

  // Subdomain-aware host editing. When an auto-domain suffix is configured and
  // the current draft is a host under that suffix (or empty), operators edit
  // just the subdomain prefix and the platform keeps the Cloudflare CNAME in
  // sync. A "custom domain" escape hatch still allows a fully custom host.
  const normalizedDomainSuffix = tenantDomainSuffix?.trim().replace(/^\*\./, "").replace(/^\./, "").toLowerCase() ?? null;
  const hostDraftTrimmed = hostDraft.trim().toLowerCase();
  const hostDraftIsUnderSuffix = Boolean(
    normalizedDomainSuffix && hostDraftTrimmed.length > 0 && hostDraftTrimmed.endsWith(`.${normalizedDomainSuffix}`),
  );
  const subdomainPrefix = hostDraftIsUnderSuffix && normalizedDomainSuffix
    ? hostDraftTrimmed.slice(0, hostDraftTrimmed.length - normalizedDomainSuffix.length - 1)
    : "";
  // Use the prefix editor when a suffix is configured and the draft is empty or
  // already a subdomain of it; a fully custom host falls back to raw editing.
  const useSubdomainEditor = Boolean(normalizedDomainSuffix) && (hostDraftTrimmed.length === 0 || hostDraftIsUnderSuffix);
  const subdomainPrefixInvalid = subdomainPrefix.length > 0 && !tenantSlugPattern.test(subdomainPrefix);

  function setSubdomainPrefix(prefix: string) {
    const cleaned = prefix.trim().toLowerCase();
    if (!normalizedDomainSuffix || cleaned.length === 0) {
      setHostDraft("");
      return;
    }
    setHostDraft(`${cleaned}.${normalizedDomainSuffix}`);
  }

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
    if (!tenantFormSlug) {
      toast.error("请填写访问标识");
      return;
    }
    if (slugLengthInvalid) {
      toast.error("访问标识需要 4 到 16 个字符");
      return;
    }
    if (slugFormatInvalid) {
      toast.error("访问标识只能使用小写字母、数字和连字符，且不能以连字符开头或结尾");
      return;
    }
    if (slugAlreadyUsed) {
      toast.error("这个访问标识已经被其他校园墙使用");
      return;
    }
    if (expectedHostAlreadyUsed) {
      toast.error("这个访问域名已经绑定到其他校园墙");
      return;
    }

    setCreatingTenant(true);
    const slug = tenantFormSlug;
    try {
      const data = await api<{ tenants: SystemTenant[] }>("/api/system/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: tenantForm.name.trim(),
          slug,
          host: tenantForm.host.trim() || null,
          themeColor: tenantForm.themeColor,
        }),
      });
      setTenants(data.tenants);
      const created = data.tenants.find((tenant) => tenant.slug === slug);
      setSelectedTenantId(created?.id ?? data.tenants[0]?.id ?? "");
      setTenantForm(createTenantFormState(new Set(data.tenants.map((tenant) => tenant.slug))));
      toast.success("新校园墙已创建，进入后按引导完成接入。");
      await Promise.all([refreshOverview(created?.id), refreshUsers(userPage), refreshOperationsAdmins(), refreshAudit(1)]);
      await onTenantCreated?.();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "创建校园墙失败");
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

  async function saveManagementHost() {
    setSavingManagementHost(true);
    try {
      const data = await api<{ managementHost: string | null }>("/api/system/settings", {
        method: "PATCH",
        body: JSON.stringify({ managementHost: managementHostDraft.trim() || null }),
      });
      setManagementHostDraft(data.managementHost ?? "");
      toast.success(data.managementHost ? "管理端 host 已更新。" : "管理端 host 已清空。");
      await refreshAudit(1);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "管理端 host 更新失败");
    } finally {
      setSavingManagementHost(false);
    }
  }

  async function enterTenantAsAdmin(tenant: SystemTenant) {
    if (!onEnterTenant) {
      return;
    }

    setEnteringTenantId(tenant.id);
    try {
      await onEnterTenant(tenant.id);
      toast.success(`正在以管理员身份进入 ${tenant.name}。`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "进入校园墙失败");
    } finally {
      setEnteringTenantId("");
    }
  }

  function toggleUserRoleFilter(role: SystemUserRoleFilter) {
    setSelectedUserRoleFilters((current) => {
      const next = current.includes(role) ? current.filter((item) => item !== role) : [...current, role];
      writeOpsUserListPreferences(mode, { keyword: userKeyword, tenantFilterId: userTenantFilterId, roleFilters: next });
      return next;
    });
    setUserPage(1);
  }

  function changeUserTenantFilter(tenantId: string) {
    const nextTenantId = tenantId === "all" ? "" : tenantId;
    setUserTenantFilterId(nextTenantId);
    setSelectedUserRoleFilters([]);
    writeOpsUserListPreferences(mode, { keyword: userKeyword, tenantFilterId: nextTenantId, roleFilters: [] });
    setUserPage(1);
  }

  function openMembershipDialog(user: SystemUser) {
    const preferredTenant = selectedTenant ?? tenants.find((tenant) => tenant.status === "active") ?? tenants[0];
    setMembershipDialogUser(user);
    setMembershipForm({ tenantId: preferredTenant?.id ?? "", role: "submitter" });
  }

  async function assignMembership() {
    const assigningGlobalRole = membershipForm.role === "system_operator" || membershipForm.role === "operations_admin";
    if (!membershipDialogUser || (!assigningGlobalRole && !membershipForm.tenantId)) {
      return;
    }

    setAssigningMembership(true);
    try {
      const result = await api<{ ok: true; retainedHigherRole?: boolean }>(`/api/system/users/${membershipDialogUser.id}/memberships`, {
        method: "POST",
        body: JSON.stringify({
          role: membershipForm.role,
          ...(assigningGlobalRole ? {} : { tenantId: membershipForm.tenantId }),
        }),
      });
      if (result.retainedHigherRole) {
        toast.info("系统运维已经是最高平台身份，不会降级为运营管理员。");
      } else {
        toast.success(assigningGlobalRole ? "平台身份已添加。" : "用户身份已更新。");
      }
      setMembershipDialogUser(null);
      await Promise.all([refreshUsers(userPage), refreshOperationsAdmins(), refreshOverview(selectedTenantId), refreshAudit(1)]);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "添加身份失败");
    } finally {
      setAssigningMembership(false);
    }
  }

  async function grantOperationsAdminTenant(user: SystemUser) {
    const tenantId = grantTenantByUserId[user.id];
    if (!tenantId) {
      return;
    }

    const busyKey = `grant:${user.id}:${tenantId}`;
    setAccessBusyKey(busyKey);
    try {
      await api(`/api/system/users/${user.id}/memberships`, {
        method: "POST",
        body: JSON.stringify({
          tenantId,
          role: "admin",
        }),
      });
      setGrantTenantByUserId((current) => ({ ...current, [user.id]: "" }));
      toast.success("运营资源访问权已更新。");
      await Promise.all([refreshOperationsAdmins(), refreshUsers(userPage), refreshOverview(selectedTenantId), refreshAudit(1)]);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "授权失败");
    } finally {
      setAccessBusyKey("");
    }
  }

  async function revokeOperationsAdminTenant(user: SystemUser, membershipId: string, tenantName: string) {
    const busyKey = `revoke:${membershipId}`;
    setAccessBusyKey(busyKey);
    try {
      await api(`/api/system/users/${user.id}/memberships/${membershipId}`, {
        method: "DELETE",
      });
      toast.success(`已移除 ${tenantName} 的访问权。`);
      await Promise.all([refreshOperationsAdmins(), refreshUsers(userPage), refreshOverview(selectedTenantId), refreshAudit(1)]);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "移除访问权失败");
    } finally {
      setAccessBusyKey("");
    }
  }

  async function revokeUserTenantMembership(user: SystemUser, membership: SystemUser["memberships"][number]) {
    if (!window.confirm(`确认移除 ${user.displayName ?? user.qqUin} 在 ${membership.tenant.name} 的${roleLabels[membership.role]}身份？`)) {
      return;
    }

    const busyKey = `revoke:${membership.id}`;
    setAccessBusyKey(busyKey);
    try {
      await api(`/api/system/users/${user.id}/memberships/${membership.id}`, {
        method: "DELETE",
      });
      toast.success(`已移除 ${membership.tenant.name} 的${roleLabels[membership.role]}身份。`);
      await Promise.all([refreshOperationsAdmins(), refreshUsers(userPage), refreshOverview(selectedTenantId), refreshAudit(1)]);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "删除租户身份失败");
    } finally {
      setAccessBusyKey("");
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
        <MetricCard title={isSystemMode ? "全局用户" : "可管理用户"} value={usersPagination.total} icon={UsersRoundIcon} accent="blue" />
        <MetricCard title="Bot 账号" value={summary.bots} icon={BotIcon} accent="violet" />
        <MetricCard title="队列中" value={queue?.runtime.queued ?? 0} icon={ActivityIcon} accent="amber" />
        <MetricCard title="发布失败" value={queue?.publishAttempts.failed ?? 0} icon={ClipboardListIcon} accent="rose" />
      </div>

      <OnboardingGuide mode={mode} hasTenants={tenants.length > 0} selectedTenant={selectedTenant} tenantDomainSuffix={tenantDomainSuffix} />

      {isSystemMode ? (
        <>
          <Card className="mt-4 rounded-md">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 font-bold">
                <Globe2Icon className="size-4" />
                管理端 host
                {loadingSettings ? <span className="ml-auto size-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" /> : null}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                用户从这个域名访问时，登录页会开放邮箱注册入口。注册成功后自动获得运营管理员身份。
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input placeholder="app.campux.top 或 localhost:5180" value={managementHostDraft} onChange={(event) => setManagementHostDraft(event.target.value)} />
                <Button className="shrink-0 font-medium" disabled={savingManagementHost} onClick={() => void saveManagementHost()}>
                  保存 host
                </Button>
              </div>
            </CardContent>
          </Card>
          <OperationsAdminAccessPanel
            users={operationsAdmins}
            tenants={tenants}
            loading={loadingOperationsAdmins}
            busyKey={accessBusyKey}
            grantTenantByUserId={grantTenantByUserId}
            onGrantTenantChange={(userId, tenantId) => setGrantTenantByUserId((current) => ({ ...current, [userId]: tenantId }))}
            onGrant={grantOperationsAdminTenant}
            onRevoke={revokeOperationsAdminTenant}
          />
        </>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="rounded-md">
          <CardContent className="p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Building2Icon className="size-4" />
                {isSystemMode ? "租户生命周期" : "我的校园墙"}
              </div>
              {loadingOverview ? <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" /> : null}
            </div>
            <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <PlusIcon className="size-4" />
                添加校园墙
              </div>
              <div className="grid gap-2">
                <Input placeholder="校园墙名称" value={tenantForm.name} onChange={(event) => setTenantForm({ ...tenantForm, name: event.target.value })} />
                <div className="grid gap-1">
                  <div className="flex gap-2">
                    <Input
                      placeholder="网址标识，例如 gzhu-wall"
                      value={tenantForm.slug}
                      maxLength={tenantSlugMaxLength}
                      aria-invalid={slugLengthInvalid || slugFormatInvalid || slugAlreadyUsed}
                      onChange={(event) => setTenantForm({ ...tenantForm, slug: event.target.value })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="重新生成网址标识"
                      className="shrink-0"
                      onClick={() => setTenantForm({ ...tenantForm, slug: generateWallSlug(existingTenantSlugs) })}
                    >
                      <RefreshCwIcon className="size-4" />
                    </Button>
                  </div>
                  <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold leading-5 text-blue-900">
                    <p>{tenantSlugHint}</p>
                    {expectedTenantHost ? (
                      <p className="mt-1 break-all">{expectedTenantHostLabel}：<span className="font-mono">{expectedTenantHost}</span></p>
                    ) : (
                      <p className="mt-1">配置自动域名后，这里会显示完整的预计访问域名。</p>
                    )}
                    <p className="mt-1 text-blue-700">规则：4-16 个字符，只能使用小写字母、数字和连字符，且不能以连字符开头或结尾。</p>
                    {slugLengthInvalid ? <p className="mt-1 text-red-700">访问标识需要 4 到 16 个字符。</p> : null}
                    {slugFormatInvalid ? <p className="mt-1 text-red-700">访问标识只能使用小写字母、数字和连字符，且不能以连字符开头或结尾。</p> : null}
                    {slugAlreadyUsed ? <p className="mt-1 text-red-700">这个访问标识已经被其他校园墙使用，请换一个。</p> : null}
                    {expectedHostAlreadyUsed ? <p className="mt-1 text-red-700">这个访问域名已经绑定到其他校园墙，请换一个。</p> : null}
                  </div>
                </div>
                <Input placeholder="专属域名（可选，留空由平台自动分配）" value={tenantForm.host} onChange={(event) => setTenantForm({ ...tenantForm, host: event.target.value })} />
                <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
                  <span className="h-9 rounded-md border border-slate-200" style={{ backgroundColor: tenantForm.themeColor }} />
                  <Input value={tenantForm.themeColor} onChange={(event) => setTenantForm({ ...tenantForm, themeColor: event.target.value })} />
                </div>
                <p className="text-xs font-semibold text-slate-500">创建后进入校园墙，会有引导一步步带你接入墙号机器人；官方部署会自动分配专属域名。</p>
                <Button className="font-medium" disabled={creatingTenant || tenantForm.name.trim().length === 0 || tenantFormSlug.length === 0 || tenantFormInvalid} onClick={() => void createTenant()}>
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
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="truncate text-xs text-slate-500">{tenant.slug}</span>
                    {tenant.status === "active" && !tenant.ready ? (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[11px] text-amber-700">未就绪</Badge>
                    ) : null}
                    {tenant.status === "active" && tenant.archiveWarningAt ? (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-[11px] text-red-700">待存档</Badge>
                    ) : null}
                  </span>
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
                <div className="flex flex-wrap items-center gap-2">
                  {onEnterTenant ? (
                    <Button size="sm" className="font-medium" disabled={enteringTenantId === selectedTenant.id} onClick={() => void enterTenantAsAdmin(selectedTenant)}>
                      作为管理员进入
                    </Button>
                  ) : null}
                  <Badge variant={selectedTenant.status === "active" ? "secondary" : "outline"}>{statusLabels[selectedTenant.status]}</Badge>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Metric label="成员" value={selectedTenant.memberCount} />
                <Metric label="墙号" value={selectedTenant.botAccountCount} />
                <Metric label="稿件" value={selectedTenant.postCount} />
              </div>

              <details className="mt-4 rounded-md bg-slate-50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-bold [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <ActivityIcon className="size-4" />
                    生命周期状态
                  </span>
                  <span className="text-xs text-slate-400">展开</span>
                </summary>
                <div className="border-t border-slate-200 px-3 pb-3 pt-2">
                <p className="mt-1 text-sm text-slate-500">{statusDescriptions[selectedTenant.status]}</p>
                {selectedTenant.status === "active" && !selectedTenant.ready ? (
                  <p className="mt-1 text-sm font-semibold text-amber-700">墙号机器人尚未接入，校园墙未就绪。创建满 30 天仍未接入且成员不超过 2 人会被自动存档。</p>
                ) : null}
                {selectedTenant.status === "active" && selectedTenant.archiveWarningAt ? (
                  <p className="mt-1 text-sm font-semibold text-red-700">已发出自动存档预警，若仍未接入机器人将于预警 7 天后自动存档。</p>
                ) : null}
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
              </details>

              <details className="mt-4 rounded-md bg-slate-50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-bold [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <Building2Icon className="size-4" />
                    专属访问域名
                  </span>
                  <span className="text-xs text-slate-400">展开</span>
                </summary>
                <div className="border-t border-slate-200 px-3 pb-3 pt-2">
                <p className="mt-1 text-sm text-slate-500">
                  设置后，从这个域名进入的用户会被固定到当前校园墙，不再展示租户选择。
                </p>
                {useSubdomainEditor ? (
                  <>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="flex flex-1 items-stretch">
                        <Input
                          className="rounded-r-none"
                          placeholder="子域名前缀，例如 gzhu-wall"
                          value={subdomainPrefix}
                          aria-invalid={subdomainPrefixInvalid}
                          onChange={(event) => setSubdomainPrefix(event.target.value)}
                        />
                        <span className="inline-flex select-none items-center rounded-r-md border border-l-0 border-slate-200 bg-slate-100 px-3 font-mono text-sm text-slate-600">
                          .{normalizedDomainSuffix}
                        </span>
                      </div>
                      <Button className="shrink-0 font-medium" disabled={savingHost || subdomainPrefixInvalid} onClick={() => void saveHost()}>
                        保存子域名
                      </Button>
                    </div>
                    <div className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold leading-5 text-blue-900">
                      {subdomainPrefix ? (
                        <p>访问域名：<span className="font-mono">{subdomainPrefix}.{normalizedDomainSuffix}</span>，保存后平台会自动同步 Cloudflare 解析。</p>
                      ) : (
                        <p>留空表示不绑定专属子域名。</p>
                      )}
                      {subdomainPrefixInvalid ? (
                        <p className="mt-1 text-red-700">子域名前缀只能使用小写字母、数字和连字符，且不能以连字符开头或结尾。</p>
                      ) : null}
                      <p className="mt-1 text-blue-700">
                        需要完全自定义的域名？
                        <button type="button" className="ml-1 underline" onClick={() => setHostDraft(selectedTenant?.host && !hostDraftIsUnderSuffix ? selectedTenant.host : `custom.example.com`)}>
                          改用自定义域名
                        </button>
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input placeholder="wall.example.com 或 localhost:5180" value={hostDraft} onChange={(event) => setHostDraft(event.target.value)} />
                      <Button className="shrink-0 font-medium" disabled={savingHost} onClick={() => void saveHost()}>
                        保存 host
                      </Button>
                    </div>
                    {normalizedDomainSuffix ? (
                      <p className="mt-2 text-xs font-semibold text-slate-500">
                        想用平台子域名？
                        <button type="button" className="ml-1 underline" onClick={() => setHostDraft("")}>
                          改用 .{normalizedDomainSuffix} 子域名
                        </button>
                      </p>
                    ) : null}
                  </>
                )}
                </div>
              </details>

              <details className="mt-4 rounded-md border border-slate-200 bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-bold [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <BotIcon className="size-4" />
                    机器人与发布目标
                  </span>
                  <span className="text-xs text-slate-400">{selectedTenant.bots.length} 个墙号</span>
                </summary>
                <div className="grid gap-2 border-t border-slate-100 p-3">
                  {selectedTenant.bots.length > 0 ? (
                    selectedTenant.bots.map((bot) => <TenantBotCard key={bot.id} bot={bot} />)
                  ) : (
                    <p className="rounded-md bg-slate-50 px-3 py-4 text-sm font-bold text-slate-500">当前校园墙还没有配置机器人。</p>
                  )}
                </div>
              </details>

              <p className="mt-4 text-sm text-slate-500">
                校园墙名称、slug、主题色、前台品牌名和公告由该租户的管理员在租户管理页维护；专属 host 在这里维护。
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
                  {isSystemMode ? "全局用户" : "墙内用户"}
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
                availableRoleFilters={availableRoleFilters}
                mode={mode}
                selectedTenantFilterId={userTenantFilterId}
                tenants={tenants}
                onKeywordChange={(keyword) => {
                  setUserKeywordDraft(keyword);
                  setUserKeyword(keyword);
                  writeOpsUserListPreferences(mode, { keyword, tenantFilterId: userTenantFilterId, roleFilters: selectedUserRoleFilters });
                  setUserPage(1);
                }}
                onKeywordSearch={() => {
                  setUserKeyword(userKeywordDraft);
                  writeOpsUserListPreferences(mode, { keyword: userKeywordDraft, tenantFilterId: userTenantFilterId, roleFilters: selectedUserRoleFilters });
                  setUserPage(1);
                }}
                onKeywordClear={() => {
                  setUserKeywordDraft("");
                  setUserKeyword("");
                  writeOpsUserListPreferences(mode, { keyword: "", tenantFilterId: userTenantFilterId, roleFilters: selectedUserRoleFilters });
                  setUserPage(1);
                }}
                onClearRoleFilters={() => {
                  setSelectedUserRoleFilters([]);
                  writeOpsUserListPreferences(mode, { keyword: userKeyword, tenantFilterId: userTenantFilterId, roleFilters: [] });
                  setUserPage(1);
                }}
                onTenantFilterChange={changeUserTenantFilter}
                onOpenAssignMembership={openMembershipDialog}
                onRevokeMembership={revokeUserTenantMembership}
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
              {isSystemMode
                ? `给 ${membershipDialogUser?.displayName ?? membershipDialogUser?.qqUin ?? "用户"} 添加平台身份，或添加/更新某个校园墙内的身份。`
                : `给 ${membershipDialogUser?.displayName ?? membershipDialogUser?.qqUin ?? "用户"} 添加/更新你负责校园墙内的身份。`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-5">
            <label className="text-sm font-semibold text-slate-700">
              校园墙
              <Select value={membershipForm.tenantId} onValueChange={(tenantId) => setMembershipForm({ ...membershipForm, tenantId })}>
                <SelectTrigger className="mt-1 w-full bg-white" disabled={membershipForm.role === "system_operator" || membershipForm.role === "operations_admin"}>
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
              <Select value={membershipForm.role} onValueChange={(role) => setMembershipForm({ ...membershipForm, role: role as TenantRole | SystemRole })}>
                <SelectTrigger className="mt-1 w-full bg-white">
                  <SelectValue placeholder="选择身份" />
                </SelectTrigger>
                <SelectContent>
                  {isSystemMode ? (
                    <>
                      <SelectItem value="operations_admin" disabled={membershipDialogUser?.systemRole === "system_operator"}>
                        运营管理员（平台）
                      </SelectItem>
                      <SelectItem value="system_operator">系统运维（全局）</SelectItem>
                    </>
                  ) : null}
                  <SelectItem value="submitter">用户</SelectItem>
                  <SelectItem value="reviewer">审核员</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              {membershipDialogUser?.systemRole === "system_operator"
                ? "系统运维已经拥有最高平台权限，不会被运营管理员身份覆盖。"
                : isSystemMode
                  ? "平台身份不需要选择校园墙；租户身份如果已存在，保存后会直接更新。"
                  : "运营管理员只能调整自己负责校园墙内的用户身份。"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={assigningMembership} onClick={() => setMembershipDialogUser(null)}>
              取消
            </Button>
            <Button
              disabled={
                assigningMembership ||
                (membershipForm.role === "operations_admin" && membershipDialogUser?.systemRole === "system_operator") ||
                ((membershipForm.role !== "system_operator" && membershipForm.role !== "operations_admin") && !membershipForm.tenantId)
              }
              onClick={() => void assignMembership()}
            >
              <ShieldPlusIcon data-icon="inline-start" />
              保存身份
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OnboardingGuide({
  mode,
  hasTenants,
  selectedTenant,
  tenantDomainSuffix,
}: {
  mode: OpsPanelMode;
  hasTenants: boolean;
  selectedTenant: SystemTenant | undefined;
  tenantDomainSuffix: string | null;
}) {
  const isSystemMode = mode === "system";
  const botReady = Boolean(selectedTenant?.ready);
  const publishReady = Boolean(selectedTenant?.bots.some((bot) => bot.publishTargets.length > 0));
  const hostReady = Boolean(selectedTenant?.host);
  const steps = [
    {
      title: isSystemMode ? "开放管理端注册" : "创建校园墙",
      detail: isSystemMode
        ? "设置管理端 host，例如 app.campux.top，让墙号运营者可以用邮箱注册运营管理员账号。"
        : tenantDomainSuffix
          ? `确认校园墙名称和访问标识。访问标识会成为 ${tenantDomainSuffix} 下的子域名前缀，创建后不可修改。`
          : "确认校园墙名称和访问标识。访问标识会用于 URL 和内部标识，创建后不可修改。",
      done: isSystemMode ? true : hasTenants,
    },
    {
      title: isSystemMode ? "分配运营资源" : "进入开通引导",
      detail: isSystemMode ? "在运营管理员资源里给账号授权可管理的校园墙；系统运维仍保留全局能力。" : "点击校园墙的「作为管理员进入」，会有引导带你一步步完成接入。",
      done: isSystemMode ? true : botReady,
    },
    {
      title: "接入墙号机器人",
      detail: "在开通引导里用墙号 QQ 登录 NapCat，粘贴连接地址，连接成功即完成认证、校园墙就绪。",
      done: botReady,
    },
    {
      title: "配置发布到 QQ 空间",
      detail: "在引导里扫码登录墙号 QQ 空间，确认登录态可用后即可开始审核发布。",
      done: publishReady,
    },
    {
      title: "专属域名",
      detail: "官方部署会在开墙时自动分配子域名；也可以由系统运维在这里手动维护。",
      done: hostReady,
    },
  ];

  return (
    <details className="mt-4 rounded-md border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <div>
            <p className="text-sm font-bold text-slate-950">{isSystemMode ? "平台交付流程" : "自助开墙流程"}</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">首次交付或自助开墙时展开查看流程。</p>
            {!isSystemMode && hasTenants ? (
              <p className="mt-1 text-xs font-bold text-blue-700">创建完成后，点击校园墙的“作为管理员进入”，按页面引导一步步完成接入。</p>
            ) : null}
          </div>
          {selectedTenant ? <Badge variant="secondary">{selectedTenant.name}</Badge> : <Badge variant="outline">帮助</Badge>}
      </summary>
      <div className="grid gap-2 border-t border-slate-100 p-4 lg:grid-cols-5">
          {steps.map((step, index) => (
            <div key={step.title} className={`rounded-md border p-3 ${step.done ? "border-green-200 bg-green-50/70" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex items-center gap-2">
                <span className={`grid size-6 place-items-center rounded-full text-xs font-black ${step.done ? "bg-green-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>
                  {step.done ? <CheckIcon className="size-3.5" /> : index + 1}
                </span>
                <p className="text-sm font-bold text-slate-950">{step.title}</p>
              </div>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{step.detail}</p>
            </div>
          ))}
      </div>
    </details>
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

function OperationsAdminAccessPanel({
  users,
  tenants,
  loading,
  busyKey,
  grantTenantByUserId,
  onGrantTenantChange,
  onGrant,
  onRevoke,
}: {
  users: SystemUser[];
  tenants: SystemTenant[];
  loading: boolean;
  busyKey: string;
  grantTenantByUserId: Record<string, string>;
  onGrantTenantChange: (userId: string, tenantId: string) => void;
  onGrant: (user: SystemUser) => void;
  onRevoke: (user: SystemUser, membershipId: string, tenantName: string) => void;
}) {
  return (
    <Card className="mt-4 rounded-md">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <ShieldPlusIcon className="size-4" />
            运营管理员资源
          </div>
          {loading ? <span className="size-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" /> : null}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          系统运维在这里查看运营管理员身份，并配置他们可以管理哪些校园墙资源。
        </p>
        <div className="mt-4 grid gap-3">
          {users.map((user) => {
            const adminMemberships = user.memberships.filter((membership) => membership.role === "admin");
            const assignedTenantIds = new Set(adminMemberships.map((membership) => membership.tenant.id));
            const availableTenants = tenants.filter((tenant) => !assignedTenantIds.has(tenant.id));
            const grantTenantId = grantTenantByUserId[user.id] ?? "";

            return (
              <div key={user.id} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-950">{user.displayName ?? "未设置昵称"}</p>
                      <Badge variant="secondary">运营管理员</Badge>
                    </div>
                    <p className="mt-0.5 text-xs font-bold text-slate-500">QQ {user.qqUin}</p>
                    {user.email ? <p className="mt-0.5 text-xs font-bold text-slate-500">{user.email}</p> : null}
                  </div>
                  <div className="flex min-w-[260px] flex-1 flex-col gap-2 sm:max-w-md sm:flex-row">
                    <Select value={grantTenantId} onValueChange={(tenantId) => onGrantTenantChange(user.id, tenantId)}>
                      <SelectTrigger className="h-9 bg-white">
                        <SelectValue placeholder={availableTenants.length > 0 ? "选择要授权的校园墙" : "已拥有全部校园墙"} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTenants.map((tenant) => (
                          <SelectItem key={tenant.id} value={tenant.id}>
                            {tenant.name} · {statusLabels[tenant.status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      className="shrink-0"
                      disabled={!grantTenantId || busyKey === `grant:${user.id}:${grantTenantId}`}
                      onClick={() => onGrant(user)}
                    >
                      授权资源
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {adminMemberships.length > 0 ? (
                    adminMemberships.map((membership) => (
                      <span key={membership.id} className="inline-flex items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">
                        {membership.tenant.name}
                        <button
                          type="button"
                          className="ml-1 inline-flex size-5 items-center justify-center rounded hover:bg-blue-100 disabled:opacity-50"
                          disabled={busyKey === `revoke:${membership.id}`}
                          onClick={() => onRevoke(user, membership.id, membership.tenant.name)}
                          aria-label={`移除 ${membership.tenant.name} 访问权`}
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </span>
                    ))
                  ) : (
                    <span className="text-xs font-semibold text-slate-500">暂未授权任何校园墙资源。</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {users.length === 0 && !loading ? <p className="mt-4 text-sm font-semibold text-slate-500">当前没有运营管理员。</p> : null}
      </CardContent>
    </Card>
  );
}

function GlobalUsersTable({
  users,
  loading,
  pagination,
  keyword,
  selectedRoleFilters,
  availableRoleFilters,
  mode,
  selectedTenantFilterId,
  tenants,
  onKeywordChange,
  onKeywordClear,
  onKeywordSearch,
  onClearRoleFilters,
  onTenantFilterChange,
  onOpenAssignMembership,
  onRevokeMembership,
  onPageChange,
  onToggleRoleFilter,
}: {
  users: SystemUser[];
  loading: boolean;
  pagination: Pagination;
  keyword: string;
  selectedRoleFilters: SystemUserRoleFilter[];
  availableRoleFilters: Array<{ value: SystemUserRoleFilter; label: string }>;
  mode: OpsPanelMode;
  selectedTenantFilterId: string;
  tenants: SystemTenant[];
  onKeywordChange: (keyword: string) => void;
  onKeywordClear: () => void;
  onKeywordSearch: () => void;
  onClearRoleFilters: () => void;
  onTenantFilterChange: (tenantId: string) => void;
  onOpenAssignMembership: (user: SystemUser) => void;
  onRevokeMembership: (user: SystemUser, membership: SystemUser["memberships"][number]) => void;
  onPageChange: (page: number) => void;
  onToggleRoleFilter: (role: SystemUserRoleFilter) => void;
}) {
  if (loading && users.length === 0) {
    return <InlineLoading title={mode === "system" ? "正在加载全局用户..." : "正在加载墙内用户..."} />;
  }

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2">
          <SearchIcon className="size-4 shrink-0 text-slate-400" />
          <Input
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            placeholder="按用户 ID、QQ 号或名称搜索账号"
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
              <SelectItem value="all">{mode === "system" ? "全部用户" : "全部可管理用户"}</SelectItem>
              {tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs font-semibold text-slate-500">
            {mode === "system"
              ? selectedTenantFilterId
                ? "筛选该校园墙内的具体身份，也可叠加平台身份"
                : "可直接筛选平台身份；选择校园墙后可筛选租户身份"
              : selectedTenantFilterId
                ? "筛选该校园墙内的具体身份"
                : "筛选你可管理校园墙内的具体身份"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {availableRoleFilters.map((filter) => {
            const active = selectedRoleFilters.includes(filter.value);
            return (
              <Button
                key={filter.value}
                type="button"
                variant={active ? "secondary" : "outline"}
                disabled={mode === "system" && !selectedTenantFilterId && filter.value !== "system_operator" && filter.value !== "operations_admin"}
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
                {user.email ? <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{user.email}</p> : null}
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5">
                {user.systemRole === "operations_admin" ? <Badge variant="secondary">运营管理员</Badge> : null}
                {user.systemRole === "system_operator" ? <Badge variant="secondary">系统运维</Badge> : null}
                {user.isTestAccount ? <Badge variant="outline">测试账号</Badge> : null}
                {user.memberships.length === 0 ? <Badge variant="outline">未加入租户</Badge> : null}
                {user.memberships.slice(0, 4).map((membership) => (
                  <span key={membership.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {membership.tenant.name} · {roleLabels[membership.role]}
                    <button
                      type="button"
                      className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      onClick={() => onRevokeMembership(user, membership)}
                      aria-label={`删除 ${membership.tenant.name} 的${roleLabels[membership.role]}身份`}
                    >
                      <Trash2Icon className="size-3" />
                    </button>
                  </span>
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
