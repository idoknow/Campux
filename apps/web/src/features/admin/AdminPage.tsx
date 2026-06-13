import { useEffect, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  CopyIcon,
  KeyRoundIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  PlusIcon,
  QrCodeIcon,
  RadioTowerIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TestTube2Icon,
  Trash2Icon,
  UserRoundIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { roleLabels, statusLabels } from "@/lib/app-model";
import { readListPreferences, writeListPreferences } from "@/lib/list-preferences";
import { hasAnyQueryParam, readQueryInt, readQueryParam, writeQueryParams } from "@/lib/url-query";
import type { AdminBanRecord, AdminBotAccount, AdminBotEvent, AdminMember, AdminMemberDetail, AdminTab, AiOverview, AiRules, OAuthClientItem, OAuthClientSecretResponse, OAuthClientSettingsResponse, OAuthServerSettings, Pagination, PublishAttemptItem, PublishTargetItem, PublishTextTemplate, TenantAiSettings, TenantMetadata, TenantRole } from "@/types/app";
import { EmptyCard, LoadingBlock, PaginationControls } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type TenantSettingsForm = {
  tenantName: string;
  slug: string;
  themeColor: string;
  brand: string;
  banner: string;
  logoUrl: string;
  pendingPostLimit: number;
  postRulesText: string;
  servicesText: string;
  imageCompressionEnabled: boolean;
  imageCompressionQuality: number;
  imageCompressionMaxDimension: number;
  botStylishMessagesEnabled: boolean;
  botPrivatePostStylishEnabled: boolean;
  publishMode: "single" | "accumulate";
  publishAccumulateMinImages: number;
  publishAccumulateMaxImages: number;
  publishAccumulateStaleMinutes: number;
  publishLlmSummaryEnabled: boolean;
  enableColorSelection: boolean;
  enableMarkdownRender: boolean;
};

type BanForm = {
  qqUin: string;
  comment: string;
  endsAt: string;
};

type MemberForm = {
  qqUin: string;
  role: TenantRole;
};

type MemberSort = "joined_asc" | "joined_desc" | "qq_asc" | "qq_desc" | "name_asc" | "name_desc" | "role_asc" | "role_desc";
type MemberListPreferences = {
  keyword: string;
  roleFilter: "all" | TenantRole;
  sort: MemberSort;
};
type BanListPreferences = {
  keyword: string;
  onlyActive: boolean;
};

const memberSortLabels: Record<MemberSort, string> = {
  joined_asc: "加入时间 · 最早优先",
  joined_desc: "加入时间 · 最新优先",
  qq_asc: "QQ 号 · 从小到大",
  qq_desc: "QQ 号 · 从大到小",
  name_asc: "显示名 · A-Z",
  name_desc: "显示名 · Z-A",
  role_asc: "身份 · 用户到管理员",
  role_desc: "身份 · 管理员到用户",
};

type BotForm = {
  qqUin: string;
  displayName: string;
  reviewGroupId: string;
  createPublishTarget: boolean;
};

type PublishTargetForm = {
  botAccountId: string;
  displayName: string;
  publishDelaySeconds: string;
  required: boolean;
  qzoneRefreshMode: "protocol" | "qr";
};

type OAuthClientForm = {
  name: string;
  description: string;
  redirectUrisText: string;
  scopesText: string;
  enabled: boolean;
  pkceRequired: boolean;
};

type OAuthClientSecretModal = {
  open: boolean;
  clientName: string;
  clientId: string;
  clientSecret: string;
};

type AiSettingsForm = {
  enabled: boolean;
  mode: "local" | "llm";
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
  temperature: number;
  timeoutSeconds: number;
  tone: string;
  strictPrivacy: boolean;
  allowedCategoriesText: string;
  modelingKeywordsText: string;
  modelingNotes: string;
  postTriggerKeywordsText: string;
};

type LlmTestResult = {
  ok: boolean;
  mode: "local" | "llm";
  provider: string;
  model: string;
  baseUrl: string;
  latencyMs: number | null;
  message: string;
};

type TenantLogoUploadResponse = {
  logoUrl: string;
  metadata: TenantMetadata;
};

const defaultOAuthSettings: OAuthServerSettings = {
  enabled: false,
  authorizationCodeTtlMinutes: 10,
  accessTokenTtlMinutes: 24 * 60,
  refreshTokenTtlDays: 30,
  pkceRequired: true,
  allowPlainPkce: false,
  stateKey: null,
};

const DEFAULT_PUBLISH_INTERVAL_SECONDS = 10;

type PublishTargetPatch = Partial<Pick<PublishTargetItem, "displayName" | "enabled" | "required" | "publishDelaySeconds" | "qzoneRefreshMode">>;

type QZoneLoginState = {
  open: boolean;
  botId: string;
  loginId: string;
  qrImage: string;
  status: string;
  message: string;
};

type CookieViewState = {
  open: boolean;
  loading: boolean;
  botName: string;
  status: string;
  checkedAt: string | null;
  cookieHeader: string;
  cookies: Array<{ name: string; value: string }>;
};

const managementTabsListClassName = "product-tabs-list";
const managementTabsTriggerClassName = "product-tabs-trigger after:hidden";

function readMemberRoleQuery(): "all" | TenantRole {
  const role = readQueryParam("role");
  return role === "submitter" || role === "reviewer" || role === "admin" ? role : "all";
}

function readMemberSortQuery(): MemberSort {
  const sort = readQueryParam("sort");
  return sort in memberSortLabels ? sort as MemberSort : "joined_asc";
}

function defaultMemberListPreferences(): MemberListPreferences {
  return {
    keyword: "",
    roleFilter: "all",
    sort: "joined_asc",
  };
}

function defaultBanListPreferences(): BanListPreferences {
  return {
    keyword: "",
    onlyActive: true,
  };
}

function memberListPreferencesKey(tenantId: string) {
  return `tenant.${tenantId}.admin.members`;
}

function banListPreferencesKey(tenantId: string) {
  return `tenant.${tenantId}.admin.bans`;
}

function isTenantRoleFilter(value: unknown): value is "all" | TenantRole {
  return value === "all" || value === "submitter" || value === "reviewer" || value === "admin";
}

function isMemberListPreferences(value: unknown): value is MemberListPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemberListPreferences>;
  return typeof candidate.keyword === "string" && isTenantRoleFilter(candidate.roleFilter) && Boolean(candidate.sort && candidate.sort in memberSortLabels);
}

function isBanListPreferences(value: unknown): value is BanListPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BanListPreferences>;
  return typeof candidate.keyword === "string" && typeof candidate.onlyActive === "boolean";
}

function readMemberListPreferences(tenantId: string): MemberListPreferences {
  if (hasAnyQueryParam(["q", "role", "sort", "page", "user"])) {
    return {
      keyword: readQueryParam("q"),
      roleFilter: readMemberRoleQuery(),
      sort: readMemberSortQuery(),
    };
  }
  return readListPreferences(memberListPreferencesKey(tenantId), defaultMemberListPreferences(), isMemberListPreferences);
}

function readBanListPreferences(tenantId: string): BanListPreferences {
  if (hasAnyQueryParam(["q", "active", "page"])) {
    return {
      keyword: readQueryParam("q"),
      onlyActive: readQueryParam("active", "1") !== "0",
    };
  }
  return readListPreferences(banListPreferencesKey(tenantId), defaultBanListPreferences(), isBanListPreferences);
}

function writeMemberListPreferences(tenantId: string, preferences: MemberListPreferences) {
  writeListPreferences(memberListPreferencesKey(tenantId), preferences);
}

function writeBanListPreferences(tenantId: string, preferences: BanListPreferences) {
  writeListPreferences(banListPreferencesKey(tenantId), preferences);
}

export function AdminPage({
  activeTab,
  selectedTenant,
  metadata,
  detailTarget,
  onDetailTargetConsumed,
  onTabChange,
  onOpenPostDetail,
  onSaved,
}: {
  activeTab: AdminTab;
  selectedTenant: TenantSummary;
  metadata: TenantMetadata;
  detailTarget?: { userId: string; nonce: number } | null;
  onDetailTargetConsumed: () => void;
  onTabChange: (tab: AdminTab) => void;
  onOpenPostDetail: (post: { id: string; displayId: number; status: string }) => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<TenantSettingsForm>(() => toForm(selectedTenant, metadata));
  const [aiOverview, setAiOverview] = useState<AiOverview | null>(null);
  const [aiForm, setAiForm] = useState<AiSettingsForm | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<LlmTestResult | null>(null);
  const [oauthSettings, setOAuthSettings] = useState<OAuthServerSettings>(() => defaultOAuthSettings);
  const [oauthClients, setOAuthClients] = useState<OAuthClientItem[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [bots, setBots] = useState<AdminBotAccount[]>([]);
  const [botEvents, setBotEvents] = useState<AdminBotEvent[]>([]);
  const [targets, setTargets] = useState<PublishTargetItem[]>([]);
  const [attempts, setAttempts] = useState<PublishAttemptItem[]>([]);
  const [bans, setBans] = useState<AdminBanRecord[]>([]);
  const [memberKeyword, setMemberKeyword] = useState(() => readMemberListPreferences(selectedTenant.id).keyword);
  const [memberRoleFilter, setMemberRoleFilter] = useState<"all" | TenantRole>(() => readMemberListPreferences(selectedTenant.id).roleFilter);
  const [memberSort, setMemberSort] = useState<MemberSort>(() => readMemberListPreferences(selectedTenant.id).sort);
  const [memberPage, setMemberPage] = useState(() => readQueryInt("page", 1, { min: 1 }));
  const [memberPagination, setMemberPagination] = useState<Pagination>(() => defaultPagination());
  const [tenantMemberTotal, setTenantMemberTotal] = useState(0);
  const [membersLoading, setMembersLoading] = useState(false);
  const [banKeyword, setBanKeyword] = useState(() => readBanListPreferences(selectedTenant.id).keyword);
  const [banPage, setBanPage] = useState(() => readQueryInt("page", 1, { min: 1 }));
  const [banPagination, setBanPagination] = useState<Pagination>(() => defaultPagination());
  const [bansLoading, setBansLoading] = useState(false);
  const [onlyActiveBans, setOnlyActiveBans] = useState(() => readBanListPreferences(selectedTenant.id).onlyActive);
  const [memberForm, setMemberForm] = useState<MemberForm>(() => defaultMemberForm());
  const [banForm, setBanForm] = useState<BanForm>(() => defaultBanForm());
  const [botForm, setBotForm] = useState<BotForm>(() => defaultBotForm());
  const [targetForm, setTargetForm] = useState<PublishTargetForm>(() => defaultPublishTargetForm());
  const [qzoneLogin, setQzoneLogin] = useState<QZoneLoginState>(() => ({ open: false, botId: "", loginId: "", qrImage: "", status: "", message: "" }));
  const [cookieView, setCookieView] = useState<CookieViewState>(() => ({
    open: false,
    loading: false,
    botName: "",
    status: "",
    checkedAt: null,
    cookieHeader: "",
    cookies: [],
  }));
  const [busy, setBusy] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [memberDetail, setMemberDetail] = useState<AdminMemberDetail | null>(null);
  const [memberDetailOpen, setMemberDetailOpen] = useState(false);
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);

  useEffect(() => {
    setForm(toForm(selectedTenant, metadata));
  }, [selectedTenant.id, selectedTenant.slug, selectedTenant.name, selectedTenant.themeColor, metadata.brand, metadata.banner, metadata.logoUrl, metadata.pendingPostLimit, metadata.postRules, metadata.services, metadata.imageCompression.enabled, metadata.imageCompression.quality, metadata.imageCompression.maxDimension, metadata.publishMode, metadata.publishAccumulate.minImages, metadata.publishAccumulate.maxImages, metadata.publishAccumulate.staleMinutes, metadata.publishLlmSummaryEnabled]);

  useEffect(() => {
    if (activeTab === "users") {
      const preferences = readMemberListPreferences(selectedTenant.id);
      setMemberKeyword(preferences.keyword);
      setMemberRoleFilter(preferences.roleFilter);
      setMemberSort(preferences.sort);
      setMemberPage(readQueryInt("page", 1, { min: 1 }));
      return;
    }
    if (activeTab === "bans") {
      const preferences = readBanListPreferences(selectedTenant.id);
      setBanKeyword(preferences.keyword);
      setOnlyActiveBans(preferences.onlyActive);
      setBanPage(readQueryInt("page", 1, { min: 1 }));
    }
  }, [activeTab, selectedTenant.id]);

  useEffect(() => {
    void refreshAdminData().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取管理数据");
    });
  }, [selectedTenant.id]);

  useEffect(() => {
    void refreshMembers(memberPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取用户列表");
    });
  }, [selectedTenant.id, memberKeyword, memberRoleFilter, memberSort, memberPage]);

  useEffect(() => {
    void refreshBans(banPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取封禁列表");
    });
  }, [selectedTenant.id, banKeyword, onlyActiveBans, banPage]);

  useEffect(() => {
    if (activeTab !== "publish" && activeTab !== "bots") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshAdminData().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeTab, selectedTenant.id]);

  useEffect(() => {
    if (!detailTarget?.userId) {
      return;
    }
    onTabChange("users");
    onDetailTargetConsumed();
    void openMemberDetail(detailTarget.userId);
  }, [detailTarget?.nonce, detailTarget?.userId]);

  useEffect(() => {
    if (activeTab !== "users") {
      return;
    }
    const userId = readQueryParam("user");
    if (!userId || memberDetailOpen || memberDetailLoading || memberDetail?.member.user.id === userId) {
      return;
    }
    void openMemberDetail(userId, { syncQuery: false });
  }, [activeTab, selectedTenant.id]);

  useEffect(() => {
    if (!qzoneLogin.open || qzoneLogin.status !== "pending" || !qzoneLogin.botId || !qzoneLogin.loginId) {
      return;
    }
    const timer = window.setInterval(() => {
      void pollQZoneLogin();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [qzoneLogin.open, qzoneLogin.status, qzoneLogin.botId, qzoneLogin.loginId]);

  async function refreshAdminData() {
    setAdminLoading(true);
    try {
      const [memberData, botData, targetData, attemptData, banData, oauthSettingsData, oauthClientData, aiOverviewData] = await Promise.all([
        fetchMembers(memberPage),
        api<{ bots: AdminBotAccount[]; events: AdminBotEvent[] }>("/api/admin/bots"),
        api<{ targets: PublishTargetItem[] }>("/api/admin/publish-targets"),
        api<{ attempts: PublishAttemptItem[] }>("/api/admin/publish-attempts?limit=20"),
        fetchBanRecords(banPage),
        api<OAuthClientSettingsResponse>("/api/admin/oauth/settings"),
        api<{ clients: OAuthClientItem[] }>("/api/admin/oauth/clients"),
        api<AiOverview>("/api/ai/overview"),
      ]);
      setMembers(memberData.members);
      setMemberPagination(memberData.pagination);
      setBots(botData.bots);
      setBotEvents(botData.events);
      setTargets(targetData.targets);
      setAttempts(attemptData.attempts);
      setBans(banData.bans);
      setBanPagination(banData.pagination);
      setOAuthSettings(oauthSettingsData.settings);
      setOAuthClients(oauthClientData.clients);
      setAiOverview(aiOverviewData);
      setAiForm(aiSettingsToForm(aiOverviewData.settings));
    } finally {
      setAdminLoading(false);
    }
  }

  async function fetchMembers(page = memberPage) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(memberPagination.limit),
      role: memberRoleFilter,
      sort: memberSort,
    });
    const keyword = memberKeyword.trim();
    if (keyword.length > 0) {
      params.set("q", keyword);
    }
    return api<{ members: AdminMember[]; pagination: Pagination; tenantMemberTotal: number }>(`/api/admin/members?${params}`);
  }

  async function refreshMembers(page = memberPage) {
    setMembersLoading(true);
    try {
      const data = await fetchMembers(page);
      setMembers(data.members);
      setMemberPagination(data.pagination);
      setTenantMemberTotal(data.tenantMemberTotal);
    } finally {
      setMembersLoading(false);
    }
  }

  async function fetchBanRecords(page = banPage) {
    const params = new URLSearchParams({
      onlyActive: String(onlyActiveBans),
      page: String(page),
      limit: String(banPagination.limit),
    });
    const keyword = banKeyword.trim();
    if (keyword.length > 0) {
      params.set("q", keyword);
    }
    return api<{ bans: AdminBanRecord[]; pagination: Pagination }>(`/api/admin/ban-records?${params}`);
  }

  async function refreshBans(page = banPage) {
    setBansLoading(true);
    try {
      const data = await fetchBanRecords(page);
      setBans(data.bans);
      setBanPagination(data.pagination);
    } finally {
      setBansLoading(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      await api("/api/admin/tenant/metadata", {
        method: "PATCH",
        body: JSON.stringify({
          tenantName: form.tenantName,
          slug: form.slug,
          themeColor: form.themeColor,
          brand: form.brand,
          banner: form.banner,
          logoUrl: form.logoUrl.trim(),
          pendingPostLimit: form.pendingPostLimit,
          postRules: form.postRulesText.split(/\r?\n/).map((rule) => rule.trim()).filter(Boolean),
          services: JSON.parse(form.servicesText) as TenantMetadata["services"],
          imageCompressionEnabled: form.imageCompressionEnabled,
          imageCompressionQuality: form.imageCompressionQuality,
          imageCompressionMaxDimension: form.imageCompressionMaxDimension,
          botStylishMessagesEnabled: form.botStylishMessagesEnabled,
          botPrivatePostStylishEnabled: form.botPrivatePostStylishEnabled,
          publishMode: form.publishMode,
          publishAccumulateMinImages: form.publishAccumulateMinImages,
          publishAccumulateMaxImages: form.publishAccumulateMaxImages,
          publishAccumulateStaleMinutes: form.publishAccumulateStaleMinutes,
          publishLlmSummaryEnabled: form.publishLlmSummaryEnabled,
          enableColorSelection: form.enableColorSelection,
          enableMarkdownRender: form.enableMarkdownRender,
        }),
      });
      await onSaved();
      toast.success("墙面设置已保存。");
    } catch (caught) {
      toast.error(caught instanceof SyntaxError ? "服务入口配置格式不正确" : caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveOAuthSettings(nextSettings: OAuthServerSettings) {
    setBusy(true);
    try {
      await api<OAuthClientSettingsResponse>("/api/admin/oauth/settings", {
        method: "PATCH",
        body: JSON.stringify(nextSettings),
      });
      await refreshAdminData();
      toast.success("OAuth 设置已保存。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存 OAuth 设置失败");
    } finally {
      setBusy(false);
    }
  }

  function buildAiSettingsPayload() {
    if (!aiForm) return null;
    const rules: AiRules = {
      tone: aiForm.tone.trim(),
      strictPrivacy: aiForm.strictPrivacy,
      allowedCategories: lines(aiForm.allowedCategoriesText),
      modelingKeywords: lines(aiForm.modelingKeywordsText),
      modelingNotes: aiForm.modelingNotes.trim(),
      postTriggerKeywords: lines(aiForm.postTriggerKeywordsText),
    };
    return {
      enabled: aiForm.enabled,
      mode: aiForm.mode,
      provider: aiForm.provider.trim(),
      baseUrl: aiForm.baseUrl.trim(),
      model: aiForm.model.trim(),
      apiKey: aiForm.apiKey.trim() || undefined,
      clearApiKey: aiForm.clearApiKey,
      temperature: aiForm.temperature,
      timeoutSeconds: aiForm.timeoutSeconds,
      rules,
    };
  }

  async function saveAiSettings() {
    const payload = buildAiSettingsPayload();
    if (!payload) return;
    setBusy(true);
    try {
      const response = await api<{ settings: TenantAiSettings }>("/api/admin/ai/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setAiForm(aiSettingsToForm(response.settings));
      setAiOverview((current) => current ? { ...current, settings: response.settings } : current);
      await onSaved();
      setAiTestResult(null);
      toast.success("AI 实验功能设置已保存。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存 AI 设置失败");
    } finally {
      setBusy(false);
    }
  }

  async function testAiSettings() {
    const payload = buildAiSettingsPayload();
    if (!payload) return;
    setAiTesting(true);
    try {
      const response = await api<{ result: LlmTestResult }>("/api/admin/ai/settings/test", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setAiTestResult(response.result);
      if (response.result.ok) {
        toast.success(response.result.message);
      } else {
        toast.error(response.result.message);
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "LLM 测试失败");
    } finally {
      setAiTesting(false);
    }
  }

  async function createOAuthClient(form: OAuthClientForm) {
    setBusy(true);
    try {
      const data = await api<OAuthClientSecretResponse>("/api/admin/oauth/clients", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description.trim() || null,
          redirectUris: form.redirectUrisText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          scopes: form.scopesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          enabled: form.enabled,
          pkceRequired: form.pkceRequired,
        }),
      });
      await refreshAdminData();
      toast.success("OAuth 应用已创建。");
      return data;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "创建 OAuth 应用失败");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function updateOAuthClient(id: string, form: OAuthClientForm) {
    setBusy(true);
    try {
      const data = await api<{ client: OAuthClientItem }>(`/api/admin/oauth/clients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          description: form.description.trim() || null,
          redirectUris: form.redirectUrisText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          scopes: form.scopesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          enabled: form.enabled,
          pkceRequired: form.pkceRequired,
        }),
      });
      await refreshAdminData();
      toast.success("OAuth 应用已更新。");
      return data;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "更新 OAuth 应用失败");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function rotateOAuthClientSecret(id: string) {
    setBusy(true);
    try {
      const data = await api<OAuthClientSecretResponse>(`/api/admin/oauth/clients/${id}/secret`, {
        method: "POST",
      });
      await refreshAdminData();
      toast.success("OAuth 密钥已重置。");
      return data;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "重置 OAuth 密钥失败");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function deleteOAuthClient(id: string) {
    setBusy(true);
    try {
      await api(`/api/admin/oauth/clients/${id}`, {
        method: "DELETE",
      });
      await refreshAdminData();
      toast.success("OAuth 应用已删除。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "删除 OAuth 应用失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateMemberRole(id: string, role: TenantRole) {
    await api(`/api/admin/members/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
    await refreshAdminData();
  }

  async function addMember() {
    const qqUin = memberForm.qqUin.trim();
    if (!qqUin) {
      toast.error("请输入 QQ 号。");
      return;
    }
    setBusy(true);
    try {
      await api("/api/admin/members", {
        method: "POST",
        body: JSON.stringify({
          qqUin,
          role: memberForm.role,
        }),
      });
      setMemberForm(defaultMemberForm());
      toast.success("用户已加入当前校园墙。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "添加用户失败");
    } finally {
      setBusy(false);
    }
  }

  async function banUser() {
    setBusy(true);
    try {
      await api("/api/admin/ban-records", {
        method: "POST",
        body: JSON.stringify({
          qqUin: banForm.qqUin,
          comment: banForm.comment,
          endsAt: new Date(banForm.endsAt).toISOString(),
        }),
      });
      setBanForm(defaultBanForm());
      toast.success("用户已封禁。");
      await refreshBans();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "封禁失败");
    } finally {
      setBusy(false);
    }
  }

  async function unban(id: string) {
    await api(`/api/admin/ban-records/${id}/unban`, {
      method: "POST",
    });
    await refreshBans();
  }

  async function addBot() {
    setBusy(true);
    try {
      await api("/api/admin/bots", {
        method: "POST",
        body: JSON.stringify({
          qqUin: botForm.qqUin.trim(),
          displayName: botForm.displayName.trim(),
          reviewGroupId: botForm.reviewGroupId.trim() || undefined,
          createPublishTarget: botForm.createPublishTarget,
        }),
      });
      setBotForm(defaultBotForm());
      toast.success("机器人已添加。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "添加机器人失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBot(id: string) {
    setBusy(true);
    try {
      await api(`/api/admin/bots/${id}`, {
        method: "DELETE",
      });
      toast.success("机器人已删除。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "删除机器人失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateBotConfig(
    botId: string,
    patch: Partial<Pick<AdminBotAccount, "displayName" | "enabled" | "reviewGroupId" | "reviewNotificationEnabled" | "autoFriendRequestApprovalEnabled" | "userMessageReply" | "userMessageReplyCooldownSeconds" | "reviewGroupMessageReply">>,
  ) {
    setBusy(true);
    try {
      await api(`/api/admin/bots/${botId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.success("机器人配置已保存。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存机器人配置失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveBotPublishTemplate(botId: string, publishTextTemplate: PublishTextTemplate) {
    setBusy(true);
    try {
      await api(`/api/admin/bots/${botId}`, {
        method: "PATCH",
        body: JSON.stringify({ publishTextTemplate }),
      });
      toast.success("配文模板已保存。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存配文模板失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTarget(target: PublishTargetItem) {
    await patchTarget(target, { enabled: !target.enabled });
  }

  async function patchTarget(target: PublishTargetItem, patch: PublishTargetPatch) {
    setBusy(true);
    try {
      await api(`/api/admin/publish-targets/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.success("发布目标配置已保存。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存发布目标失败");
    } finally {
      setBusy(false);
    }
  }

  async function addPublishTarget() {
    const botAccountId = targetForm.botAccountId || bots[0]?.id;
    if (!botAccountId) {
      toast.error("需要先添加机器人。");
      return;
    }

    setBusy(true);
    try {
      await api("/api/admin/publish-targets", {
        method: "POST",
        body: JSON.stringify({
          botAccountId,
          displayName: targetForm.displayName.trim(),
          required: targetForm.required,
          publishDelaySeconds: Number(targetForm.publishDelaySeconds || DEFAULT_PUBLISH_INTERVAL_SECONDS),
          qzoneRefreshMode: targetForm.qzoneRefreshMode,
        }),
      });
      setTargetForm(defaultPublishTargetForm());
      toast.success("发布目标已添加。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "添加发布目标失败");
    } finally {
      setBusy(false);
    }
  }

  async function retryAttempt(id: string) {
    await api(`/api/admin/publish-attempts/${id}/retry`, {
      method: "POST",
    });
    await refreshAdminData();
  }

  async function refreshPublishLogs() {
    await refreshAdminData();
    toast.success("发布日志已刷新。");
  }

  async function refreshQZoneCookies(botId: string, mode: "protocol" | "qr") {
    setBusy(true);
    try {
      if (mode === "protocol") {
        const data = await api<{ cookieNames: string[] }>(`/api/admin/bots/${botId}/qzone-cookies/protocol`, { method: "POST" });
        toast.success(`空间登录态已刷新（${data.cookieNames.length} 项）。`);
        await refreshAdminData();
        return;
      }
      const data = await api<{ id: string; qrImage: string; status: string; message: string | null }>(`/api/admin/bots/${botId}/qzone-login`, { method: "POST" });
      setQzoneLogin({ open: true, botId, loginId: data.id, qrImage: data.qrImage, status: data.status, message: data.message ?? "等待扫码" });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "刷新空间登录态失败");
    } finally {
      setBusy(false);
    }
  }

  async function checkQZoneCookies(botId: string) {
    setBusy(true);
    try {
      const data = await api<{ session: { status: string; message: string | null } | null }>(`/api/admin/bots/${botId}/qzone-cookies/check`, { method: "POST" });
      toast.success(data.session ? `空间登录态检测完成：${sessionStatusLabel(data.session.status)}${data.session.message ? `，${data.session.message}` : ""}` : "这个机器人还没有空间登录态。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "检测空间登录态失败");
    } finally {
      setBusy(false);
    }
  }

  async function viewQZoneCookies(botId: string) {
    setCookieView((current) => ({ ...current, open: true, loading: true, botName: "", status: "", checkedAt: null, cookieHeader: "", cookies: [] }));
    try {
      const data = await api<{
        bot: { displayName: string; qqUin: string };
        session: { status: string; checkedAt: string | null };
        cookieHeader: string;
        cookies: Array<{ name: string; value: string }>;
      }>(`/api/admin/bots/${botId}/qzone-cookies`);
      setCookieView({
        open: true,
        loading: false,
        botName: `${data.bot.displayName} · QQ ${data.bot.qqUin}`,
        status: data.session.status,
        checkedAt: data.session.checkedAt,
        cookieHeader: data.cookieHeader,
        cookies: data.cookies,
      });
    } catch (caught) {
      setCookieView((current) => ({ ...current, loading: false }));
      toast.error(caught instanceof Error ? caught.message : "读取空间登录态失败");
    }
  }

  async function copyCookieHeader() {
    if (!cookieView.cookieHeader) {
      return;
    }
    await navigator.clipboard.writeText(cookieView.cookieHeader);
    toast.success("登录态已复制。");
  }

  async function pollQZoneLogin() {
    if (!qzoneLogin.botId || !qzoneLogin.loginId) return;
    const data = await api<{ status: string; message: string | null; cookieNames: string[] }>(`/api/admin/bots/${qzoneLogin.botId}/qzone-login/${qzoneLogin.loginId}`);
    setQzoneLogin((current) => ({ ...current, status: data.status, message: data.message ?? current.message }));
    if (data.status === "succeeded") {
      toast.success(`扫码登录完成，空间登录态已刷新（${data.cookieNames.length} 项）。`);
      await refreshAdminData();
    }
  }

  async function openMemberDetail(userId: string, options: { syncQuery?: boolean } = {}) {
    if (options.syncQuery !== false) {
      writeQueryParams({ user: userId }, "push");
    }
    setMemberDetailOpen(true);
    setMemberDetailLoading(true);
    try {
      const data = await api<AdminMemberDetail>(`/api/admin/members/users/${userId}`);
      setMemberDetail(data);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "无法读取用户详情");
      writeQueryParams({ user: null });
      setMemberDetailOpen(false);
    } finally {
      setMemberDetailLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pt-4">
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as AdminTab)} className="min-h-0 flex-1">
        <TabsList className={managementTabsListClassName}>
          <TabsTrigger value="users" className={managementTabsTriggerClassName}>
            用户
          </TabsTrigger>
          <TabsTrigger value="bans" className={managementTabsTriggerClassName}>
            封禁
          </TabsTrigger>
          <TabsTrigger value="metadata" className={managementTabsTriggerClassName}>
            墙面设置
          </TabsTrigger>
          <TabsTrigger value="bots" className={managementTabsTriggerClassName}>
            机器人
          </TabsTrigger>
          <TabsTrigger value="publish" className={managementTabsTriggerClassName}>
            发布
          </TabsTrigger>
        </TabsList>
        {adminLoading ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">
            <span className="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            正在加载管理数据...
          </div>
        ) : null}

            <TabsContent value="users" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <UsersPanel
                members={members}
                pagination={memberPagination}
                tenantMemberTotal={tenantMemberTotal}
                keyword={memberKeyword}
                roleFilter={memberRoleFilter}
                sort={memberSort}
                form={memberForm}
                busy={busy}
                loading={membersLoading || adminLoading}
                onKeywordChange={(value) => {
                  setMemberKeyword(value);
                  setMemberPage(1);
                  writeMemberListPreferences(selectedTenant.id, { keyword: value, roleFilter: memberRoleFilter, sort: memberSort });
                  writeQueryParams({ q: value.trim() || null, page: null });
                }}
                onRoleFilterChange={(value) => {
                  setMemberRoleFilter(value);
                  setMemberPage(1);
                  writeMemberListPreferences(selectedTenant.id, { keyword: memberKeyword, roleFilter: value, sort: memberSort });
                  writeQueryParams({ role: value === "all" ? null : value, page: null });
                }}
                onSortChange={(value) => {
                  setMemberSort(value);
                  setMemberPage(1);
                  writeMemberListPreferences(selectedTenant.id, { keyword: memberKeyword, roleFilter: memberRoleFilter, sort: value });
                  writeQueryParams({ sort: value === "joined_asc" ? null : value, page: null });
                }}
                onPageChange={(page) => {
                  setMemberPage(page);
                  writeQueryParams({ page: page > 1 ? page : null });
                }}
                onFormChange={setMemberForm}
                onAddMember={() => void addMember()}
                onRoleChange={(id, role) => void updateMemberRole(id, role)}
                onViewMember={(member) => void openMemberDetail(member.user.id)}
                onPrepareBan={(member) => {
                  setBanForm((current) => ({ ...current, qqUin: member.user.qqUin }));
                  onTabChange("bans");
                }}
              />
            </TabsContent>

            <TabsContent value="bans" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <BansPanel
                bans={bans}
                pagination={banPagination}
                form={banForm}
                keyword={banKeyword}
                onlyActive={onlyActiveBans}
                busy={busy}
                loading={bansLoading || adminLoading}
                onFormChange={setBanForm}
                onKeywordChange={(value) => {
                  setBanKeyword(value);
                  setBanPage(1);
                  writeBanListPreferences(selectedTenant.id, { keyword: value, onlyActive: onlyActiveBans });
                  writeQueryParams({ q: value.trim() || null, page: null });
                }}
                onOnlyActiveChange={(value) => {
                  setOnlyActiveBans(value);
                  setBanPage(1);
                  writeBanListPreferences(selectedTenant.id, { keyword: banKeyword, onlyActive: value });
                  writeQueryParams({ active: value ? null : "0", page: null });
                }}
                onPageChange={(page) => {
                  setBanPage(page);
                  writeQueryParams({ page: page > 1 ? page : null });
                }}
                onRefresh={() => void refreshBans()}
                onSubmit={() => void banUser()}
                onUnban={(id) => void unban(id)}
              />
            </TabsContent>

            <TabsContent value="metadata" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <div className="flex flex-col gap-4">
                <MetadataPanel form={form} busy={busy} onFormChange={setForm} onSave={() => void saveSettings()} onUploaded={onSaved} />
                {aiOverview && aiForm ? (
                  <details>
                    <summary className="product-surface flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <div>
                        <p className="text-base font-semibold text-slate-950">AI 实验功能</p>
                        <p className="mt-1 text-sm text-slate-600">校园建模、文本分析规则和 LLM 配置。</p>
                      </div>
                      <Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 shadow-none">按需展开</Badge>
                    </summary>
                    <div className="mt-3">
                      <AdminAiSettingsPanel
                        overview={aiOverview}
                        form={aiForm}
                        busy={busy}
                        testing={aiTesting}
                        testResult={aiTestResult}
                        onFormChange={setAiForm}
                        onSave={() => void saveAiSettings()}
                        onTest={() => void testAiSettings()}
                      />
                    </div>
                  </details>
                ) : (
                  <Card className="rounded-md border-slate-200 bg-white shadow-none">
                    <CardContent className="p-4">
                      <LoadingBlock title="正在加载 AI 实验功能设置" />
                    </CardContent>
                  </Card>
                )}
                <details>
                  <summary className="product-surface flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                    <div>
                      <p className="text-base font-semibold text-slate-950">OAuth 服务</p>
                      <p className="mt-1 text-sm text-slate-600">第三方应用授权、令牌有效期和应用密钥。</p>
                    </div>
                    <Badge className="rounded-full bg-slate-100 text-slate-600 shadow-none">按需展开</Badge>
                  </summary>
                  <div className="mt-3">
                    <OAuthPanel
                      settings={oauthSettings}
                      clients={oauthClients}
                      busy={busy}
                      loading={adminLoading}
                      onSaveSettings={saveOAuthSettings}
                      onCreateClient={(clientForm) => createOAuthClient(clientForm)}
                      onUpdateClient={(id, clientForm) => updateOAuthClient(id, clientForm)}
                      onRotateSecret={(id) => rotateOAuthClientSecret(id)}
                      onDeleteClient={(id) => deleteOAuthClient(id)}
                    />
                  </div>
                </details>
              </div>
            </TabsContent>

            <TabsContent value="bots" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <BotsPanel
                bots={bots}
                events={botEvents}
                form={botForm}
                busy={busy}
                onFormChange={setBotForm}
                onAdd={() => void addBot()}
                onDelete={(id) => void deleteBot(id)}
                onUpdateConfig={(botId, patch) => void updateBotConfig(botId, patch)}
                onRefresh={() => void refreshAdminData()}
              />
            </TabsContent>

            <TabsContent value="publish" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <PublishPanel
                targets={targets}
                attempts={attempts}
                bots={bots}
                form={targetForm}
                busy={busy}
                onFormChange={setTargetForm}
                onAdd={() => void addPublishTarget()}
                onToggleTarget={(target) => void toggleTarget(target)}
                onPatchTarget={(target, patch) => void patchTarget(target, patch)}
                onRefreshQZone={(botId, mode) => void refreshQZoneCookies(botId, mode)}
                onCheckQZone={(botId) => void checkQZoneCookies(botId)}
                onViewCookies={(botId) => void viewQZoneCookies(botId)}
                onRetry={(id) => void retryAttempt(id)}
                onRefreshLogs={() => void refreshPublishLogs()}
                onSaveTemplate={(botId, template) => void saveBotPublishTemplate(botId, template)}
              />
            </TabsContent>
      </Tabs>
      <MemberDetailDialog
        open={memberDetailOpen}
        loading={memberDetailLoading}
        detail={memberDetail}
        onOpenPostDetail={onOpenPostDetail}
        onOpenChange={(open) => {
          setMemberDetailOpen(open);
          if (!open) {
            setMemberDetail(null);
            writeQueryParams({ user: null });
          }
        }}
      />
      <Dialog open={qzoneLogin.open} onOpenChange={(open) => setQzoneLogin((current) => ({ ...current, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QZone 扫码登录</DialogTitle>
            <DialogDescription>使用对应墙号的 QQ 手机端扫码，系统会自动检查登录状态。</DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-5">
            {qzoneLogin.qrImage ? <img src={qzoneLogin.qrImage} alt="QZone 登录二维码" className="mx-auto size-56 rounded-md border border-slate-200" /> : null}
            <p className="mt-3 text-center text-sm font-bold text-slate-600">{qzoneLogin.message || qzoneLogin.status}</p>
            <Button className="mt-4 w-full" variant="outline" onClick={() => void pollQZoneLogin()}>立即检查</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={cookieView.open} onOpenChange={(open) => setCookieView((current) => ({ ...current, open }))}>
        <DialogContent className="w-[min(720px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>空间登录态</DialogTitle>
            <DialogDescription>{cookieView.botName || "读取当前发布目标的空间登录态"}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 pb-5">
            {cookieView.loading ? (
              <p className="text-sm font-bold text-slate-500">正在读取...</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`rounded-full shadow-none ${sessionStatusBadgeClass(cookieView.status || "unchecked")}`}>登录态 {sessionStatusLabel(cookieView.status || "unchecked")}</Badge>
                  <span className="text-xs font-bold text-slate-500">最近检测：{cookieView.checkedAt ? formatDateTime(cookieView.checkedAt) : "未检测"}</span>
                </div>
                <Textarea readOnly value={cookieView.cookieHeader} className="mt-3 min-h-28 resize-none bg-slate-50 font-mono text-xs" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void copyCookieHeader()} disabled={!cookieView.cookieHeader}>
                    <CopyIcon data-icon="inline-start" />
                    复制登录态
                  </Button>
                </div>
                <div className="mt-3 rounded-md border border-slate-200">
                  {cookieView.cookies.map((cookie) => (
                    <div key={cookie.name} className="grid gap-1 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[140px_minmax(0,1fr)]">
                      <span className="font-bold text-slate-700">{cookie.name}</span>
                      <span className="break-all font-mono text-slate-500">{cookie.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UsersPanel({
  members,
  pagination,
  tenantMemberTotal,
  keyword,
  roleFilter,
  sort,
  form,
  busy,
  loading,
  onKeywordChange,
  onRoleFilterChange,
  onSortChange,
  onPageChange,
  onFormChange,
  onAddMember,
  onRoleChange,
  onViewMember,
  onPrepareBan,
}: {
  members: AdminMember[];
  pagination: Pagination;
  tenantMemberTotal: number;
  keyword: string;
  roleFilter: "all" | TenantRole;
  sort: MemberSort;
  form: MemberForm;
  busy: boolean;
  loading: boolean;
  onKeywordChange: (value: string) => void;
  onRoleFilterChange: (value: "all" | TenantRole) => void;
  onSortChange: (value: MemberSort) => void;
  onPageChange: (page: number) => void;
  onFormChange: (form: MemberForm) => void;
  onAddMember: () => void;
  onRoleChange: (id: string, role: TenantRole) => void;
  onViewMember: (member: AdminMember) => void;
  onPrepareBan: (member: AdminMember) => void;
}) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={UserRoundIcon} title="用户管理" description="搜索用户、调整角色或准备封禁" color="product-accent-blue" />
        <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800">
          当前校园墙共有 {tenantMemberTotal} 个用户
        </div>
        <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
          <Input
            className="bg-white"
            inputMode="numeric"
            placeholder="输入 QQ 号添加到当前校园墙"
            value={form.qqUin}
            onChange={(event) => onFormChange({ ...form, qqUin: event.target.value.replace(/\D/g, "") })}
          />
          <Select value={form.role} onValueChange={(role) => onFormChange({ ...form, role: role as TenantRole })}>
            <SelectTrigger className="bg-white font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="submitter">{roleLabels.submitter}</SelectItem>
              <SelectItem value="reviewer">{roleLabels.reviewer}</SelectItem>
              <SelectItem value="admin">{roleLabels.admin}</SelectItem>
            </SelectContent>
          </Select>
          <Button disabled={busy || !form.qqUin.trim()} onClick={onAddMember}>
            添加用户
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_220px]">
          <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
            搜索
            <Input className="bg-white" placeholder="用户 ID、QQ 号或名称" value={keyword} onChange={(event) => onKeywordChange(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
            身份
            <Select value={roleFilter} onValueChange={(value) => onRoleFilterChange(value as "all" | TenantRole)}>
              <SelectTrigger className="bg-white font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部身份</SelectItem>
                <SelectItem value="submitter">{roleLabels.submitter}</SelectItem>
                <SelectItem value="reviewer">{roleLabels.reviewer}</SelectItem>
                <SelectItem value="admin">{roleLabels.admin}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
            排序
            <Select value={sort} onValueChange={(value) => onSortChange(value as MemberSort)}>
              <SelectTrigger className="bg-white font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(memberSortLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {loading ? <LoadingBlock title="正在加载用户列表..." /> : null}
          {!loading && members.length === 0 ? <EmptyCard title="暂无用户" /> : null}
          {!loading && members.map((member) => (
            <div
              key={member.id}
              role="button"
              tabIndex={0}
              className="product-row-card flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
              onClick={() => onViewMember(member)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onViewMember(member);
                }
              }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <QqAvatar qqUin={member.user.qqUin} name={member.user.displayName ?? member.user.qqUin} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{member.user.displayName ?? member.user.qqUin}</p>
                  <p className="text-xs text-slate-500">QQ {member.user.qqUin} · 加入 {formatDateTime(member.createdAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                  <Select value={member.role} onValueChange={(role) => onRoleChange(member.id, role as TenantRole)}>
                    <SelectTrigger className="bg-white font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="submitter">{roleLabels.submitter}</SelectItem>
                      <SelectItem value="reviewer">{roleLabels.reviewer}</SelectItem>
                      <SelectItem value="admin">{roleLabels.admin}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={(event) => {
                  event.stopPropagation();
                  onPrepareBan(member);
                }}>
                  封禁
                </Button>
              </div>
            </div>
          ))}
        </div>
        <PaginationControls pagination={pagination} busy={loading} onPageChange={onPageChange} />
      </CardContent>
    </Card>
  );
}

function MemberDetailDialog({
  open,
  loading,
  detail,
  onOpenPostDetail,
  onOpenChange,
}: {
  open: boolean;
  loading: boolean;
  detail: AdminMemberDetail | null;
  onOpenPostDetail: (post: { id: string; displayId: number; status: string }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const user = detail?.member.user;
  const title = user ? `${user.displayName ?? user.qqUin} 的用户详情` : "用户详情";
  const postStatusEntries = Object.entries(detail?.stats.postsByStatus ?? {}).filter(([, count]) => count > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>仅展示当前校园墙内的身份、投稿和封禁记录。</DialogDescription>
        </DialogHeader>

        {loading ? <LoadingBlock title="正在加载用户详情..." /> : null}

        {!loading && detail ? (
          <div className="grid gap-4">
            <div className="product-row-card flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <QqAvatar qqUin={detail.member.user.qqUin} name={detail.member.user.displayName ?? detail.member.user.qqUin} />
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-950">{detail.member.user.displayName ?? detail.member.user.qqUin}</p>
                  <p className="text-xs font-semibold text-slate-500">QQ {detail.member.user.qqUin} · 用户 ID {detail.member.user.id}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{roleLabels[detail.member.role]}</Badge>
                {detail.member.user.systemRole ? <Badge variant="outline">平台身份：{detail.member.user.systemRole}</Badge> : null}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <MiniStat label="投稿总数" value={detail.stats.postsTotal} />
              <MiniStat label="生效封禁" value={detail.stats.activeBanCount} />
              <MiniStat label="加入时间" value={formatDateTime(detail.member.createdAt)} />
            </div>

            <section className="rounded-md border border-slate-200 bg-white p-3">
              <p className="text-sm font-bold text-slate-900">投稿状态</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {postStatusEntries.length === 0 ? <Badge variant="outline">暂无投稿</Badge> : null}
                {postStatusEntries.map(([status, count]) => (
                  <Badge key={status} variant="outline">
                    {statusLabels[status] ?? status} · {count}
                  </Badge>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-3">
              <p className="text-sm font-bold text-slate-900">最近投稿</p>
              <div className="mt-2 grid gap-2">
                {detail.posts.length === 0 ? <EmptyCard title="暂无投稿记录" /> : null}
                {detail.posts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className="rounded-md border border-slate-100 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-white"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenPostDetail(post);
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">#{post.displayId}</Badge>
                        <Badge variant="secondary">{statusLabels[post.status] ?? post.status}</Badge>
                        {post.anonymous ? <Badge variant="outline">匿名</Badge> : null}
                        {post.imageCount > 0 ? <Badge variant="outline">{post.imageCount} 张图</Badge> : null}
                      </div>
                      <span className="text-xs font-bold text-slate-400">{formatDateTime(post.createdAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm font-semibold text-slate-700">{post.text}</p>
                    <p className="mt-2 text-xs font-bold text-blue-600">点击跳转到稿件列表并查看详情</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-3">
              <p className="text-sm font-bold text-slate-900">封禁记录</p>
              <div className="mt-2 grid gap-2">
                {detail.bans.length === 0 ? <EmptyCard title="暂无封禁记录" /> : null}
                {detail.bans.map((ban) => (
                  <div key={ban.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant={ban.active ? "destructive" : "outline"}>{ban.active ? "生效中" : "已结束"}</Badge>
                      <span className="text-xs font-bold text-slate-400">{formatDateTime(ban.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-700">{ban.comment}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {formatDateTime(ban.startsAt)} 至 {formatDateTime(ban.endsAt)}
                      {ban.operator ? ` · 操作人 ${ban.operator.displayName ?? ban.operator.qqUin}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function BansPanel({
  bans,
  pagination,
  form,
  keyword,
  onlyActive,
  busy,
  loading,
  onFormChange,
  onKeywordChange,
  onOnlyActiveChange,
  onPageChange,
  onRefresh,
  onSubmit,
  onUnban,
}: {
  bans: AdminBanRecord[];
  pagination: Pagination;
  form: BanForm;
  keyword: string;
  onlyActive: boolean;
  busy: boolean;
  loading: boolean;
  onFormChange: (form: BanForm) => void;
  onKeywordChange: (value: string) => void;
  onOnlyActiveChange: (value: boolean) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onSubmit: () => void;
  onUnban: (id: string) => void;
}) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={ShieldCheckIcon} title="封禁管理" description="查看封禁记录，或临时封禁用户" color="product-accent-rose" />
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            className="bg-white"
            inputMode="numeric"
            placeholder="输入要封禁的 QQ 号"
            value={form.qqUin}
            onChange={(event) => onFormChange({ ...form, qqUin: event.target.value.replace(/\D/g, "") })}
          />
          <Input className="bg-white" placeholder="封禁原因" value={form.comment} onChange={(event) => onFormChange({ ...form, comment: event.target.value })} />
          <Input className="bg-white" type="datetime-local" value={form.endsAt} onChange={(event) => onFormChange({ ...form, endsAt: event.target.value })} />
          <Button className="font-medium" variant="destructive" disabled={busy || !form.qqUin || !form.comment || !form.endsAt} onClick={onSubmit}>
            封禁
          </Button>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <Input className="bg-white" placeholder="按用户 ID、QQ 号或名称筛选封禁记录" value={keyword} onChange={(event) => onKeywordChange(event.target.value)} />
          <label className="inline-flex items-center gap-2 rounded-md bg-white px-3 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={onlyActive} onChange={(event) => onOnlyActiveChange(event.target.checked)} />
            仅生效中
          </label>
          <Button variant="outline" onClick={onRefresh}>
            查找
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {loading ? (
            <LoadingBlock title="正在加载封禁记录..." />
          ) : bans.length === 0 ? (
            <EmptyCard title="暂无封禁记录" />
          ) : (
            bans.map((ban) => (
            <div key={ban.id} className="product-row-card flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="flex min-w-0 items-start gap-3">
                  {ban.user ? <QqAvatar qqUin={ban.user.qqUin} name={ban.user.displayName ?? ban.user.qqUin} /> : <div className="size-10 rounded-full bg-slate-100" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{ban.user?.displayName ?? ban.user?.qqUin ?? "未知用户"}</p>
                      <Badge className={`rounded-full shadow-none ${ban.active ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-slate-100 text-slate-500"}`}>
                        {ban.active ? "生效中" : "已结束"}
                      </Badge>
                    </div>
                    {ban.user ? <p className="text-xs text-slate-500">QQ {ban.user.qqUin}</p> : null}
                    <p className="mt-1 text-sm text-slate-600">{ban.comment}</p>
                    <p className="text-xs text-slate-500">结束时间：{formatBanDateTime(ban.endsAt)}</p>
                  </div>
                </div>
                {ban.active ? (
                  <Button variant="outline" size="sm" onClick={() => onUnban(ban.id)}>
                    解封
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </div>
        <PaginationControls pagination={pagination} busy={loading} onPageChange={onPageChange} />
      </CardContent>
    </Card>
  );
}

function MetadataPanel({
  form,
  busy,
  onFormChange,
  onSave,
  onUploaded,
}: {
  form: TenantSettingsForm;
  busy: boolean;
  onFormChange: (form: TenantSettingsForm) => void;
  onSave: () => void;
  onUploaded: () => Promise<void>;
}) {
  const [logoUploading, setLogoUploading] = useState(false);

  async function uploadLogo(file: File) {
    const formData = new FormData();
    formData.append("logo", file, file.name);
    setLogoUploading(true);
    try {
      const result = await api<TenantLogoUploadResponse>("/api/admin/tenant/logo", {
        method: "POST",
        body: formData,
      });
      onFormChange({ ...form, logoUrl: result.logoUrl });
      await onUploaded();
      toast.success("Logo 已上传并保存。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Logo 上传失败");
    } finally {
      setLogoUploading(false);
    }
  }

  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={MegaphoneIcon} title="墙面设置" description="校园墙名称、公告、Logo、投稿规则和服务入口" color="product-accent-green" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            校园墙名称
            <Input value={form.tenantName} onChange={(event) => onFormChange({ ...form, tenantName: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            访问标识
            <Input value={form.slug} onChange={(event) => onFormChange({ ...form, slug: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            主题色
            <span className="flex items-center gap-2">
              <span className="h-9 w-9 rounded-md border border-slate-200" style={{ backgroundColor: form.themeColor }} />
              <Input value={form.themeColor} onChange={(event) => onFormChange({ ...form, themeColor: event.target.value })} />
            </span>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            前台品牌名
            <Input value={form.brand} onChange={(event) => onFormChange({ ...form, brand: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            前台公告
            <Textarea
              className="min-h-24 resize-y bg-white text-sm leading-6"
              value={form.banner}
              placeholder="显示在投稿页顶部的公告，可换行。"
              onChange={(event) => onFormChange({ ...form, banner: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            校园墙 Logo
            <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
              <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                <img src={form.logoUrl.trim() || "/logo.svg"} alt="校园墙 Logo 预览" className="h-full w-full object-contain p-2" />
              </span>
              <div className="grid gap-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={form.logoUrl} placeholder="留空则使用 Campux 默认 Logo" onChange={(event) => onFormChange({ ...form, logoUrl: event.target.value })} />
                  <Button asChild variant="outline" disabled={busy || logoUploading} className="shrink-0">
                    <label>
                      {logoUploading ? "上传中..." : "上传图片"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                        className="hidden"
                        disabled={busy || logoUploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) {
                            void uploadLogo(file);
                          }
                        }}
                      />
                    </label>
                  </Button>
                </div>
                <span className="text-xs font-normal text-slate-500">可直接上传 5MB 内的 JPG/PNG/GIF/WebP/HEIC 图片，上传后会自动保存为当前校园墙 Logo；也可以继续手动填写 http(s) 或站内图片地址。</span>
              </div>
            </div>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            每个用户同时待审核上限
            <Input
              type="number"
              min={0}
              max={50}
              value={form.pendingPostLimit}
              onChange={(event) => onFormChange({ ...form, pendingPostLimit: Number(event.target.value) })}
            />
            <span className="text-xs font-normal text-slate-500">0 表示不限制，默认建议 1 条。</span>
          </label>
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">图片压缩</p>
                <p className="text-xs text-slate-500">投稿图片会自动压缩，关闭后按原图存储。</p>
              </div>
              <Switch
                checked={form.imageCompressionEnabled}
                disabled={busy}
                onCheckedChange={(value) => onFormChange({ ...form, imageCompressionEnabled: value })}
                aria-label="启用图片压缩"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                压缩质量 (40-95)
                <Input
                  type="number"
                  min={40}
                  max={95}
                  value={form.imageCompressionQuality}
                  disabled={!form.imageCompressionEnabled}
                  onChange={(event) => onFormChange({ ...form, imageCompressionQuality: Number(event.target.value) })}
                />
                <span className="text-xs font-normal text-slate-500">JPEG/WebP 质量，默认 80。</span>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                最大边长 (512-4096)
                <Input
                  type="number"
                  min={512}
                  max={4096}
                  value={form.imageCompressionMaxDimension}
                  disabled={!form.imageCompressionEnabled}
                  onChange={(event) => onFormChange({ ...form, imageCompressionMaxDimension: Number(event.target.value) })}
                />
                <span className="text-xs font-normal text-slate-500">宽或高超过该值时按比例缩放，默认 2048。</span>
              </label>
            </div>
          </div>
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">发布模式</p>
                <p className="text-xs text-slate-500">控制审核通过的稿件如何发到 QQ 空间说说。</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onFormChange({ ...form, publishMode: "single" })}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  form.publishMode === "single"
                    ? "border-sky-500 bg-sky-50 ring-1 ring-sky-200"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-semibold text-slate-900">逐条发布</p>
                <p className="text-xs text-slate-500">每条稿件单独发一条说说（默认）。</p>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onFormChange({ ...form, publishMode: "accumulate" })}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  form.publishMode === "accumulate"
                    ? "border-sky-500 bg-sky-50 ring-1 ring-sky-200"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className="text-sm font-semibold text-slate-900">批量发布</p>
                <p className="text-xs text-slate-500">攒够设定的图片数量，把多条稿件合并成一条说说发出。</p>
              </button>
            </div>
            {form.publishMode === "accumulate" ? (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="grid gap-1 text-sm font-medium">
                    图片数量下限
                    <Input
                      type="number"
                      min={1}
                      max={9}
                      value={form.publishAccumulateMinImages}
                      disabled={busy}
                      onChange={(event) => onFormChange({ ...form, publishAccumulateMinImages: Number(event.target.value) })}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium">
                    图片数量上限
                    <Input
                      type="number"
                      min={1}
                      max={9}
                      value={form.publishAccumulateMaxImages}
                      disabled={busy}
                      onChange={(event) => onFormChange({ ...form, publishAccumulateMaxImages: Number(event.target.value) })}
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium">
                    停滞自动发出（分钟）
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={form.publishAccumulateStaleMinutes}
                      disabled={busy}
                      onChange={(event) => onFormChange({ ...form, publishAccumulateStaleMinutes: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  每条稿件图片数 = 1 张稿件渲染图 + 配图数。攒够下限即可发出；达到上限会尽快发出。停滞超过设定分钟数（默认 30）即使未到批量也会把已达下限的稿件发掉。
                </p>
                {form.publishAccumulateMaxImages < form.publishAccumulateMinImages ? (
                  <p className="text-xs font-semibold text-rose-600">上限不能小于下限，保存时会自动校正为下限值。</p>
                ) : null}
                <p className="text-xs font-semibold text-amber-600">
                  注意：QQ 空间单条说说图片上限约 9 张，下限/上限请勿超过 9；批量模式下的稿件不支持程序撤回。
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium text-slate-900">说说文字 AI 总结</p>
              <p className="text-xs text-slate-500">开启后，发布说说时在 @原作者 之后追加一句不超过 16 字的 AI 总结（仅说说文字，不影响渲染图）。批量发送时每条子稿件各自生成。需先在「AI」中配置并启用 LLM，否则不会生成。</p>
            </div>
            <Switch
              checked={form.publishLlmSummaryEnabled}
              disabled={busy}
              onCheckedChange={(value) => onFormChange({ ...form, publishLlmSummaryEnabled: value })}
              aria-label="启用说说文字 AI 总结"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium text-slate-900">Bot 多彩消息</p>
              <p className="text-xs text-slate-500">开启后机器人反馈消息将使用多风格随机语句，更具趣味性。</p>
            </div>
            <Switch
              checked={form.botStylishMessagesEnabled}
              disabled={busy}
              onCheckedChange={(value) => onFormChange({ ...form, botStylishMessagesEnabled: value })}
              aria-label="启用 Bot 多彩消息"
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2">
            <div>
              <p className="text-sm font-medium text-slate-900">对话投稿多彩消息</p>
              <p className="text-xs text-slate-500">开启后对话框投稿流程中的提示语将使用多风格随机语句。</p>
            </div>
            <Switch
              checked={form.botPrivatePostStylishEnabled}
              disabled={busy}
              onCheckedChange={(value) => onFormChange({ ...form, botPrivatePostStylishEnabled: value })}
              aria-label="启用对话投稿多彩消息"
            />
          </div>
          <details className="rounded-md border border-slate-200 bg-slate-50 md:col-span-2">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">高级功能</summary>
            <div className="grid gap-3 border-t border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Markdown 渲染</p>
                  <p className="text-xs text-slate-500">开启后，稿件正文中的 Markdown 语法（表格、列表、引用、代码等）会渲染为对应样式。</p>
                </div>
                <Switch
                  checked={form.enableMarkdownRender}
                  disabled={busy}
                  onCheckedChange={(value) => onFormChange({ ...form, enableMarkdownRender: value })}
                  aria-label="启用 Markdown 渲染"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">颜色选择</p>
                  <p className="text-xs text-slate-500">开启后，投稿页显示背景颜色和文字颜色选择器，用户可选择投稿卡片颜色。</p>
                </div>
                <Switch
                  checked={form.enableColorSelection}
                  disabled={busy}
                  onCheckedChange={(value) => onFormChange({ ...form, enableColorSelection: value })}
                  aria-label="启用颜色选择"
                />
              </div>
            </div>
          </details>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            投稿规则，每行一条
            <Textarea className="min-h-32" value={form.postRulesText} onChange={(event) => onFormChange({ ...form, postRulesText: event.target.value })} />
          </label>
          <details className="rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">高级：服务入口配置</summary>
            <label className="mt-3 grid gap-1 text-sm font-medium">
              服务入口 JSON
              <Textarea className="min-h-36 font-mono text-xs" value={form.servicesText} onChange={(event) => onFormChange({ ...form, servicesText: event.target.value })} />
              <span className="text-xs font-normal text-slate-500">用于批量配置服务页入口；普通账户设置入口会自动保留。</span>
            </label>
          </details>
        </div>
        <Button className="mt-4 px-5 font-medium" disabled={busy || logoUploading} onClick={onSave}>
          <SaveIcon data-icon="inline-start" />
          保存墙面设置
        </Button>
      </CardContent>
    </Card>
  );
}

function AdminAiSettingsPanel({
  overview,
  form,
  busy,
  testing,
  testResult,
  onFormChange,
  onSave,
  onTest,
}: {
  overview: AiOverview;
  form: AiSettingsForm;
  busy: boolean;
  testing: boolean;
  testResult: LlmTestResult | null;
  onFormChange: (form: AiSettingsForm) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle
          icon={SparklesIcon}
          title="AI 实验功能"
          description="开启校园建模、配置 LLM 能力和文本分析规则"
          color="product-accent-violet"
          action={<Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 shadow-none">实验性</Badge>}
        />

        <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">启用 AI 建模</p>
              <p className="mt-1 text-xs text-slate-500">{form.mode === "llm" ? "启用后使用 LLM 分析，失败时本地规则回退。" : "启用后使用本地文本规则分析。"}</p>
            </div>
            <Switch checked={form.enabled} disabled={busy || testing} onCheckedChange={(enabled) => onFormChange({ ...form, enabled })} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              模式
              <Select value={form.mode} disabled={busy || testing} onValueChange={(mode) => onFormChange({ ...form, mode: mode as "local" | "llm" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">本地规则</SelectItem>
                  <SelectItem value="llm">LLM</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              服务商
              <Input value={form.provider} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, provider: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              接口地址
              <Input value={form.baseUrl} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, baseUrl: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              模型
              <Input value={form.model} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, model: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              API 密钥
              <Input
                type="password"
                name="apiKey"
                value={form.apiKey}
                placeholder={overview.settings.apiKeyConfigured ? "保持不变" : "未配置"}
                disabled={busy || testing}
                onChange={(event) => onFormChange({ ...form, apiKey: event.target.value, clearApiKey: false })}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              随机度
              <Input type="number" step="0.1" min={0} max={1} value={form.temperature} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, temperature: Number(event.target.value) })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              超时秒数
              <Input type="number" min={5} max={120} value={form.timeoutSeconds} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, timeoutSeconds: Number(event.target.value) })} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              墙号语气
              <Input value={form.tone} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, tone: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              建模备注
              <Input value={form.modelingNotes} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, modelingNotes: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              允许分类
              <Textarea className="min-h-24" value={form.allowedCategoriesText} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, allowedCategoriesText: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              建模关键词
              <Textarea className="min-h-24" value={form.modelingKeywordsText} disabled={busy || testing} onChange={(event) => onFormChange({ ...form, modelingKeywordsText: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              投稿触发关键词
              <Textarea
                className="min-h-24"
                value={form.postTriggerKeywordsText}
                disabled={busy || testing}
                onChange={(event) => onFormChange({ ...form, postTriggerKeywordsText: event.target.value })}
                placeholder="每行一个关键词，如 发帖、吐槽、表白"
              />
              <span className="text-xs text-muted-foreground">发送 #关键词 即可开始对话投稿。默认 #投稿 始终生效。</span>
            </label>
          </div>

          {testResult ? (
            <div className={`rounded-md border p-3 text-sm font-semibold leading-6 ${testResult.ok ? "border-green-200 bg-green-50 text-green-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              <div>{testResult.message}</div>
              <div className="mt-1 text-xs opacity-80">{testResult.model} · {testResult.latencyMs === null ? "本地模式" : `${testResult.latencyMs}ms`}</div>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {overview.settings.apiKeyConfigured ? (
              <Button type="button" variant="outline" disabled={busy || testing} onClick={() => onFormChange({ ...form, apiKey: "", clearApiKey: true })}>
                <KeyRoundIcon data-icon="inline-start" />
                清除密钥
              </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={busy || testing} onClick={onTest}>
              <TestTube2Icon data-icon="inline-start" />
              {testing ? "测试中" : "测试连接"}
            </Button>
            <Button type="submit" disabled={busy || testing}>
              <SaveIcon data-icon="inline-start" />
              保存 AI 设置
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function OAuthPanel({
  settings,
  clients,
  busy,
  loading,
  onSaveSettings,
  onCreateClient,
  onUpdateClient,
  onRotateSecret,
  onDeleteClient,
}: {
  settings: OAuthServerSettings;
  clients: OAuthClientItem[];
  busy: boolean;
  loading: boolean;
  onSaveSettings: (settings: OAuthServerSettings) => Promise<void>;
  onCreateClient: (form: OAuthClientForm) => Promise<OAuthClientSecretResponse | null>;
  onUpdateClient: (id: string, form: OAuthClientForm) => Promise<{ client: OAuthClientItem } | null>;
  onRotateSecret: (id: string) => Promise<OAuthClientSecretResponse | null>;
  onDeleteClient: (id: string) => Promise<void>;
}) {
  const [settingsForm, setSettingsForm] = useState<OAuthServerSettings>(settings);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<OAuthClientItem | null>(null);
  const [clientForm, setClientForm] = useState<OAuthClientForm>(() => defaultOAuthClientForm());
  const [secretModal, setSecretModal] = useState<OAuthClientSecretModal>({ open: false, clientId: "", clientName: "", clientSecret: "" });

  useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  useEffect(() => {
    if (!clientDialogOpen) {
      setEditingClient(null);
      setClientForm(defaultOAuthClientForm());
    }
  }, [clientDialogOpen]);

  function openCreateDialog() {
    setEditingClient(null);
    setClientForm(defaultOAuthClientForm());
    setClientDialogOpen(true);
  }

  function openEditDialog(client: OAuthClientItem) {
    setEditingClient(client);
    setClientForm(oauthClientToForm(client));
    setClientDialogOpen(true);
  }

  async function saveClient() {
    const payload = {
      ...clientForm,
      description: clientForm.description.trim(),
    };

    if (editingClient) {
      const result = await onUpdateClient(editingClient.id, payload);
      if (result) {
        setClientDialogOpen(false);
      }
      return;
    }

    const created = await onCreateClient(payload);
    if (created) {
      setClientDialogOpen(false);
      setSecretModal({ open: true, clientId: created.client.id, clientName: created.client.name, clientSecret: created.clientSecret });
    }
  }

  async function rotateSecret(client: OAuthClientItem) {
    const rotated = await onRotateSecret(client.id);
    if (rotated) {
      setSecretModal({ open: true, clientId: rotated.client.id, clientName: rotated.client.name, clientSecret: rotated.clientSecret });
    }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(secretModal.clientSecret);
    toast.success("密钥已复制。");
  }

  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle
          icon={ShieldCheckIcon}
          title="OAuth 服务"
          description="管理授权服务器开关、令牌生命周期和 OAuth 应用"
          color="product-accent-violet"
          action={
            <Button variant="outline" size="sm" onClick={openCreateDialog} disabled={busy}>
              新建应用
            </Button>
          }
        />

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-950">OAuth 服务器设置</p>
              <p className="mt-1 text-xs text-slate-500">控制是否允许授权、令牌和 PKCE 行为。</p>
            </div>
            <Badge className={`rounded-full shadow-none ${settingsForm.enabled ? "bg-green-50 text-green-800 ring-1 ring-green-200" : "bg-slate-100 text-slate-500"}`}>
              {settingsForm.enabled ? "已启用" : "已停用"}
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" checked={settingsForm.enabled} onChange={(event) => setSettingsForm({ ...settingsForm, enabled: event.target.checked })} />
                启用 OAuth 服务
              </span>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              授权码有效期（分钟）
              <Input type="number" min={1} max={1440} value={settingsForm.authorizationCodeTtlMinutes} onChange={(event) => setSettingsForm({ ...settingsForm, authorizationCodeTtlMinutes: Number(event.target.value) || 0 })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Access Token 有效期（分钟）
              <Input type="number" min={5} max={10080} value={settingsForm.accessTokenTtlMinutes} onChange={(event) => setSettingsForm({ ...settingsForm, accessTokenTtlMinutes: Number(event.target.value) || 0 })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Refresh Token 有效期（天）
              <Input type="number" min={1} max={3650} value={settingsForm.refreshTokenTtlDays} onChange={(event) => setSettingsForm({ ...settingsForm, refreshTokenTtlDays: Number(event.target.value) || 0 })} />
            </label>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" checked={settingsForm.pkceRequired} onChange={(event) => setSettingsForm({ ...settingsForm, pkceRequired: event.target.checked })} />
                强制 PKCE
              </span>
            </label>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              <span className="inline-flex items-center gap-2">
                <input type="checkbox" checked={settingsForm.allowPlainPkce} onChange={(event) => setSettingsForm({ ...settingsForm, allowPlainPkce: event.target.checked })} />
                允许 plain PKCE（不推荐）
              </span>
            </label>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              <span className="inline-flex items-center gap-2">
                OAuth 状态加密密钥（可选）
              </span>
              <div className="flex gap-2">
                <Input className="font-mono" value={settingsForm.stateKey ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, stateKey: event.target.value || null })} />
                <Button size="sm" onClick={() => {
                  const arr = new Uint8Array(32);
                  crypto.getRandomValues(arr);
                  const bin = String.fromCharCode(...Array.from(arr));
                  const b64 = btoa(bin);
                  setSettingsForm((s) => ({ ...s, stateKey: b64 }));
                  toast.success("已生成 stateKey，请保存设置。");
                }}>
                  生成密钥
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSettingsForm((s) => ({ ...s, stateKey: null }))}>
                  清除
                </Button>
              </div>
              <p className="text-xs text-slate-500">用于可选地加密/解密 `state` 参数（Base64，32 字节）。</p>
            </label>
          </div>
          <Button className="mt-4 px-5 font-medium" disabled={busy} onClick={() => void onSaveSettings(settingsForm)}>
            保存 OAuth 设置
          </Button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-950">OAuth 应用</p>
            <p className="mt-1 text-xs text-slate-500">注册第三方应用，保存后只展示一次密钥。</p>
          </div>
          <span className="text-xs font-medium text-slate-500">共 {clients.length} 个应用</span>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {loading ? <LoadingBlock title="正在加载 OAuth 应用..." /> : null}
          {!loading && clients.length === 0 ? <EmptyCard title="暂无 OAuth 应用" /> : null}
          {!loading && clients.map((client) => (
            <div key={client.id} className="product-row-card flex flex-col gap-3 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-semibold text-slate-950">{client.name}</p>
                    <Badge className={`rounded-full shadow-none ${client.enabled ? "bg-green-50 text-green-800 ring-1 ring-green-200" : "bg-slate-100 text-slate-500"}`}>
                      {client.enabled ? "启用" : "停用"}
                    </Badge>
                    {client.pkceRequired ? <Badge className="rounded-full bg-blue-50 text-blue-700 shadow-none">PKCE</Badge> : null}
                  </div>
                  <p className="mt-1 break-all text-xs font-mono text-slate-500">Client ID: {client.clientId}</p>
                  {client.description ? <p className="mt-1 text-sm text-slate-600">{client.description}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => openEditDialog(client)}>编辑</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void rotateSecret(client)}>重置密钥</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`确定要删除 OAuth 应用“${client.name}”吗？`)) {
                        return;
                      }
                      void onDeleteClient(client.id);
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 text-xs text-slate-500 md:grid-cols-2">
                <div>
                  <p className="font-medium text-slate-500">回调地址</p>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-slate-600">{client.redirectUris.join("\n")}</p>
                </div>
                <div>
                  <p className="font-medium text-slate-500">Scopes</p>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-slate-600">{client.scopes.join("\n")}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
          <DialogContent className="w-[min(720px,calc(100vw-32px))]">
            <DialogHeader>
              <DialogTitle>{editingClient ? "编辑 OAuth 应用" : "新建 OAuth 应用"}</DialogTitle>
              <DialogDescription>填写应用信息、回调地址和允许的权限范围。</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium md:col-span-2">
                应用名称
                <Input value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm font-medium md:col-span-2">
                应用说明
                <Input value={clientForm.description} onChange={(event) => setClientForm({ ...clientForm, description: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm font-medium md:col-span-2">
                回调地址，每行一个
                <Textarea className="min-h-28" value={clientForm.redirectUrisText} onChange={(event) => setClientForm({ ...clientForm, redirectUrisText: event.target.value })} />
              </label>
              <label className="grid gap-1 text-sm font-medium md:col-span-2">
                允许的 Scope，每行一个
                <Textarea className="min-h-28" value={clientForm.scopesText} onChange={(event) => setClientForm({ ...clientForm, scopesText: event.target.value })} />
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={clientForm.enabled} onChange={(event) => setClientForm({ ...clientForm, enabled: event.target.checked })} />
                启用应用
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={clientForm.pkceRequired} onChange={(event) => setClientForm({ ...clientForm, pkceRequired: event.target.checked })} />
                强制 PKCE
              </label>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setClientDialogOpen(false)}>取消</Button>
                <Button disabled={busy || !clientForm.name.trim() || !clientForm.redirectUrisText.trim()} onClick={() => void saveClient()}>
                  {editingClient ? "保存应用" : "创建应用"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={secretModal.open} onOpenChange={(open) => setSecretModal((current) => ({ ...current, open }))}>
          <DialogContent className="w-[min(720px,calc(100vw-32px))]">
            <DialogHeader>
              <DialogTitle>{secretModal.clientName} 的密钥</DialogTitle>
              <DialogDescription>这个密钥只会完整显示一次，请尽快保存到你的应用配置中。</DialogDescription>
            </DialogHeader>
            <div className="px-5 pb-5">
              <Textarea readOnly value={secretModal.clientSecret} className="min-h-24 resize-none bg-slate-50 font-mono text-xs" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void copySecret()} disabled={!secretModal.clientSecret}>
                  复制密钥
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function BotsPanel({
  bots,
  events,
  form,
  busy,
  onFormChange,
  onAdd,
  onDelete,
  onUpdateConfig,
  onRefresh,
}: {
  bots: AdminBotAccount[];
  events: AdminBotEvent[];
  form: BotForm;
  busy: boolean;
  onFormChange: (form: BotForm) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onUpdateConfig: (
    botId: string,
    patch: Partial<Pick<AdminBotAccount, "displayName" | "enabled" | "reviewGroupId" | "reviewNotificationEnabled" | "autoFriendRequestApprovalEnabled" | "userMessageReply" | "userMessageReplyCooldownSeconds" | "reviewGroupMessageReply">>,
  ) => void;
  onRefresh: () => void;
}) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle
          icon={BotIcon}
          title="机器人"
          description="管理当前校园墙的 Bot、连接状态和事件"
          color="product-accent-violet"
          action={<Button variant="outline" size="sm" onClick={onRefresh}>刷新</Button>}
        />

        <BotSetupGuide />

        <details className="product-subsection mt-4 overflow-hidden" open={bots.length === 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="text-sm font-semibold text-slate-950">添加机器人</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">只在接入新墙号时展开填写。</p>
            </div>
            <Badge variant="outline">{bots.length === 0 ? "需要添加" : "展开"}</Badge>
          </summary>
          <div className="grid gap-3 border-t border-slate-200 p-3">
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
                墙号 QQ
                <Input className="bg-white" value={form.qqUin} onChange={(event) => onFormChange({ ...form, qqUin: event.target.value.replace(/\D/g, "") })} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
                显示名
                <Input className="bg-white" value={form.displayName} onChange={(event) => onFormChange({ ...form, displayName: event.target.value })} />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
                审核群号 <span className="font-normal text-slate-400">可选</span>
                <Input className="bg-white" value={form.reviewGroupId} onChange={(event) => onFormChange({ ...form, reviewGroupId: event.target.value.replace(/\D/g, "") })} />
              </label>
              <Button className="font-medium" disabled={busy || !form.qqUin.trim() || !form.displayName.trim()} onClick={onAdd}>
                <PlusIcon data-icon="inline-start" />
                添加
              </Button>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              <span>
                同时创建发布目标
                <span className="block text-xs font-normal text-slate-500">添加墙号后自动创建一个对应的空间发布目标。</span>
              </span>
              <Switch checked={form.createPublishTarget} onCheckedChange={(checked) => onFormChange({ ...form, createPublishTarget: checked })} aria-label="同时创建发布目标" />
            </label>
          </div>
        </details>

        <div className="mt-3 grid gap-3">
          {bots.length === 0 ? (
            <p className="text-sm font-bold text-slate-500">还没有绑定机器人。</p>
          ) : (
            bots.map((bot) => (
              <div key={bot.id} className="product-row-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold text-slate-950">{bot.displayName}</p>
                      <Badge className={`rounded-full shadow-none ${bot.connection.online ? "bg-green-50 text-green-800 ring-1 ring-green-200" : "bg-slate-100 text-slate-500"}`}>
                        {bot.connection.online ? "在线" : "离线"}
                      </Badge>
                      {!bot.enabled ? <Badge className="rounded-full bg-red-50 text-red-700 ring-1 ring-red-200 shadow-none">停用</Badge> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                      <span><span className="mr-1 text-xs font-semibold text-slate-400">QQ</span><span className="font-semibold">{bot.qqUin}</span></span>
                      <span><span className="mr-1 text-xs font-semibold text-slate-400">审核群</span><span className="font-semibold">{bot.reviewGroupId ?? "未设置"}</span></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CopyBotUrlButton bot={bot} />
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => onDelete(bot.id)}>
                      <Trash2Icon data-icon="inline-start" />
                      删除
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-sm">
                  <BotMetric icon={bot.connection.online ? WifiIcon : WifiOffIcon} label="连接" value={bot.connection.online ? `${bot.connection.connectionCount} 条` : "未连接"} />
                  <BotMetric label="最近心跳" value={bot.lastSeenAt ? formatDateTime(bot.lastSeenAt) : "暂无"} />
                  <BotMetric label="发布目标" value={`${bot.publishTargets.length} 个`} />
                </div>

                <BotConfigEditor bot={bot} busy={busy} onSave={(patch) => onUpdateConfig(bot.id, patch)} />
                <OneBotConnectionBox bot={bot} />
              </div>
            ))
          )}
        </div>

        <div className="product-subsection mt-4 p-3">
          <p className="font-semibold text-slate-950">最近事件</p>
          <div className="mt-2 flex flex-col gap-2">
            {events.length === 0 ? (
              <p className="text-sm font-bold text-slate-500">暂无 Bot 事件。</p>
            ) : (
              events.slice(0, 12).map((event) => (
                <div key={event.id} className="product-row-card flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-semibold text-slate-700">{formatBotEventAction(event.action)}</span>
                  <span className="text-slate-500">{event.actor?.displayName ?? event.actor?.qqUin ?? "系统"}</span>
                  <span className="text-xs font-bold text-slate-400">{formatDateTime(event.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyBotUrlButton({ bot }: { bot: AdminBotAccount }) {
  const url = buildOneBotConnectionUrl(bot);

  async function copyUrl() {
    await navigator.clipboard.writeText(url);
    toast.success("OneBot 连接 URL 已复制。");
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void copyUrl()}>
      <CopyIcon data-icon="inline-start" />
      复制连接
    </Button>
  );
}

function OneBotConnectionBox({ bot }: { bot: AdminBotAccount }) {
  const url = buildOneBotConnectionUrl(bot);

  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-sm font-semibold text-slate-800">协议连接</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">只有接入或排查 NapCat 时需要查看。</p>
        </div>
        <Badge variant="outline">高级</Badge>
      </summary>
      <div className="border-t border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-500">OneBot 反向 WebSocket 地址</p>
          <CopyBotUrlButton bot={bot} />
        </div>
        <div className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
          <p className="break-all font-mono text-xs leading-5 text-slate-700">{url}</p>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-500">
          每个机器人都有独立 token，协议端用这个地址连接后会自动归属到当前校园墙。
        </p>
        <div className="mt-2 grid gap-1.5 text-xs font-semibold text-slate-500">
          <p className="rounded-md bg-white px-2 py-1.5 ring-1 ring-slate-200">NapCat：添加反向 WebSocket 客户端。</p>
          <p className="rounded-md bg-white px-2 py-1.5 ring-1 ring-slate-200">地址：粘贴上方完整 URL。</p>
          <p className="rounded-md bg-white px-2 py-1.5 ring-1 ring-slate-200">QQ：协议端登录 QQ 必须是 {bot.qqUin}。</p>
        </div>
      </div>
    </details>
  );
}

function BotSetupGuide() {
  const steps = [
    {
      icon: BotIcon,
      title: "添加 Bot",
      detail: "填写墙号 QQ、显示名和审核群号。只有这个审核群里的命令和 @ 提示会被处理，其他群会静默忽略。",
    },
    {
      icon: RadioTowerIcon,
      title: "连接 NapCat",
      detail: "在机器人卡片复制 OneBot URL，粘贴到 NapCat 的反向 WebSocket 客户端配置里。",
    },
    {
      icon: MessageSquareTextIcon,
      title: "确认消息流",
      detail: "新投稿会发到审核群；审核员可以在群内 #通过、#拒绝、#重发、#登录 或 #扫码登录。",
    },
  ];

  return (
    <details className="mt-4 rounded-md border border-violet-100 bg-violet-50/35">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-sm font-bold text-slate-950">机器人接入步骤</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">首次接入时展开查看。</p>
        </div>
        <Badge className="rounded-full bg-white text-violet-700 ring-1 ring-violet-200 shadow-none">帮助</Badge>
      </summary>
      <div className="grid gap-2 border-t border-violet-100 p-3">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="rounded-md bg-white p-3 ring-1 ring-violet-100">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-950">
                <Icon className="size-4 text-violet-600" />
                {step.title}
              </div>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{step.detail}</p>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function BotConfigEditor({
  bot,
  busy,
  onSave,
}: {
  bot: AdminBotAccount;
  busy: boolean;
  onSave: (patch: Partial<Pick<AdminBotAccount, "displayName" | "enabled" | "reviewGroupId" | "reviewNotificationEnabled" | "autoFriendRequestApprovalEnabled" | "userMessageReply" | "userMessageReplyCooldownSeconds" | "reviewGroupMessageReply">>) => void;
}) {
  const [displayName, setDisplayName] = useState(bot.displayName);
  const [reviewGroupId, setReviewGroupId] = useState(bot.reviewGroupId ?? "");
  const [userMessageReply, setUserMessageReply] = useState(bot.userMessageReply);
  const [userMessageReplyCooldownSeconds, setUserMessageReplyCooldownSeconds] = useState(String(bot.userMessageReplyCooldownSeconds));
  const [reviewGroupMessageReply, setReviewGroupMessageReply] = useState(bot.reviewGroupMessageReply);
  const [reviewNotificationEnabled, setReviewNotificationEnabled] = useState(bot.reviewNotificationEnabled);
  const [autoFriendRequestApprovalEnabled, setAutoFriendRequestApprovalEnabled] = useState(bot.autoFriendRequestApprovalEnabled);
  const [enabled, setEnabled] = useState(bot.enabled);

  useEffect(() => {
    setDisplayName(bot.displayName);
    setReviewGroupId(bot.reviewGroupId ?? "");
    setUserMessageReply(bot.userMessageReply);
    setUserMessageReplyCooldownSeconds(String(bot.userMessageReplyCooldownSeconds));
    setReviewGroupMessageReply(bot.reviewGroupMessageReply);
    setReviewNotificationEnabled(bot.reviewNotificationEnabled);
    setAutoFriendRequestApprovalEnabled(bot.autoFriendRequestApprovalEnabled);
    setEnabled(bot.enabled);
  }, [bot.displayName, bot.reviewGroupId, bot.userMessageReply, bot.userMessageReplyCooldownSeconds, bot.reviewGroupMessageReply, bot.reviewNotificationEnabled, bot.autoFriendRequestApprovalEnabled, bot.enabled]);

  const trimmedDisplayName = displayName.trim();
  const trimmedReviewGroupId = reviewGroupId.trim();
  const trimmedUserMessageReply = userMessageReply.trim();
  const trimmedReviewGroupMessageReply = reviewGroupMessageReply.trim();
  const normalizedCooldownSeconds = Math.max(0, Number(userMessageReplyCooldownSeconds || 0));
  const changed = trimmedDisplayName !== bot.displayName
    || trimmedReviewGroupId !== (bot.reviewGroupId ?? "")
    || trimmedUserMessageReply !== bot.userMessageReply
    || normalizedCooldownSeconds !== bot.userMessageReplyCooldownSeconds
    || trimmedReviewGroupMessageReply !== bot.reviewGroupMessageReply
    || reviewNotificationEnabled !== bot.reviewNotificationEnabled
    || autoFriendRequestApprovalEnabled !== bot.autoFriendRequestApprovalEnabled
    || enabled !== bot.enabled;
  const canSave = !busy && Boolean(trimmedDisplayName) && Boolean(trimmedUserMessageReply) && Boolean(trimmedReviewGroupMessageReply) && changed;

  function saveConfig() {
    onSave({
      displayName: trimmedDisplayName,
      reviewGroupId: trimmedReviewGroupId || null,
      userMessageReply: trimmedUserMessageReply,
      userMessageReplyCooldownSeconds: normalizedCooldownSeconds,
      reviewGroupMessageReply: trimmedReviewGroupMessageReply,
      reviewNotificationEnabled,
      autoFriendRequestApprovalEnabled,
      enabled,
    });
  }

  return (
    <div className="mt-2 grid gap-2">
      <details className="rounded-md border border-slate-200 bg-slate-50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <div>
            <p className="text-sm font-semibold text-slate-800">基础设置</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">显示名、审核群、启用状态。</p>
          </div>
          <Badge variant={changed ? "secondary" : "outline"}>{changed ? "有改动" : "设置"}</Badge>
        </summary>
        <div className="grid gap-3 border-t border-slate-200 p-3">
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
              墙号 QQ
              <Input className="bg-slate-50 text-slate-500" value={bot.qqUin} readOnly />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
              显示名
              <Input className="bg-white" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              <span className="text-[11px] font-normal text-slate-400">建议填「1 号墙」这类名称。</span>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-500">
              审核群号 <span className="font-normal text-slate-400">可留空</span>
              <Input className="bg-white" value={reviewGroupId} onChange={(event) => setReviewGroupId(event.target.value.replace(/\D/g, ""))} />
            </label>
          </div>
          <div className="grid gap-2">
            <label className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              <span>
                启用机器人
                <span className="block text-xs font-normal text-slate-500">关闭后不处理连接和消息。</span>
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="启用机器人" />
            </label>
            <label className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              <span>
                发送审核通知
                <span className="block text-xs font-normal leading-5 text-slate-500">新稿件、撤回等通知由这个墙号发送。</span>
              </span>
              <Switch checked={reviewNotificationEnabled} onCheckedChange={setReviewNotificationEnabled} aria-label="发送稿件审核通知" />
            </label>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" disabled={!canSave} onClick={saveConfig}>
              保存基础设置
            </Button>
          </div>
        </div>
      </details>

      <details className="rounded-md border border-slate-200 bg-slate-50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <div>
            <p className="text-sm font-semibold text-slate-800">自动回复</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">私聊提示、审核群提示和限速。</p>
          </div>
          <Badge variant="outline">低频</Badge>
        </summary>
        <div className="grid gap-3 border-t border-slate-200 p-3">
          <div className="grid gap-3">
            <label className="text-xs font-semibold text-slate-500">
              私聊非命令自动回复
              <Textarea
                className="mt-1 min-h-28 bg-white"
                value={userMessageReply}
                onChange={(event) => setUserMessageReply(event.target.value)}
                placeholder="用户没有发送命令时自动回复的消息"
              />
            </label>
            <label className="text-xs font-semibold text-slate-500">
              审核群 @ 非指令提示
              <Textarea
                className="mt-1 min-h-28 bg-white"
                value={reviewGroupMessageReply}
                onChange={(event) => setReviewGroupMessageReply(event.target.value)}
                placeholder="审核群里 @ 机器人但没有发送指令时回复的提示"
              />
            </label>
          </div>
          <label className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
            <span>
              自动通过好友申请
              <span className="block text-xs font-normal leading-5 text-slate-500">收到好友申请后随机延时通过，降低 QQ 风控概率；每个墙号独立控制。</span>
            </span>
            <Switch checked={autoFriendRequestApprovalEnabled} onCheckedChange={setAutoFriendRequestApprovalEnabled} aria-label="自动通过好友申请" />
          </label>
          <div className="rounded-md border border-slate-200 bg-white p-2">
            <p className="text-xs font-semibold text-slate-500">自动回复限速</p>
            <Input
              className="mt-2 bg-white"
              inputMode="numeric"
              value={userMessageReplyCooldownSeconds}
              onChange={(event) => setUserMessageReplyCooldownSeconds(event.target.value.replace(/\D/g, ""))}

            />
            <p className="mt-1 text-xs font-semibold text-slate-400">秒内不重复回复；填 0 表示不限速。</p>
            <Button className="mt-3 w-full" variant="outline" size="sm" disabled={!canSave} onClick={saveConfig}>
              保存自动回复
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

function BotPublishTemplateEditor({ bot, busy, onSave }: { bot: AdminBotAccount; busy: boolean; onSave: (template: PublishTextTemplate) => void }) {
  const [template, setTemplate] = useState<PublishTextTemplate>(() => normalizePublishTemplate(bot.publishTextTemplate));
  const [dirty, setDirty] = useState(false);
  const persistedTemplate = normalizePublishTemplate(bot.publishTextTemplate);
  const persistedTemplateKey = stringifyPublishTemplate(persistedTemplate);
  const currentTemplateKey = stringifyPublishTemplate(template);

  useEffect(() => {
    if (!dirty) {
      setTemplate(persistedTemplate);
    }
  }, [bot.id, persistedTemplateKey, dirty]);

  useEffect(() => {
    if (dirty && currentTemplateKey === persistedTemplateKey) {
      setDirty(false);
    }
  }, [dirty, currentTemplateKey, persistedTemplateKey]);

  function updateTemplate(patch: Partial<PublishTextTemplate>) {
    setDirty(true);
    setTemplate((current) => ({ ...current, ...patch }));
  }

  function saveTemplate() {
    setDirty(false);
    onSave(template);
  }

  const previewParts = [];
  if (template.customText.trim()) previewParts.push(template.customText.trim());
  if (template.includePostId) previewParts.push("#12");
  if (template.includeAuthorMention) previewParts.push("@{uin:10000,nick:,who:1}");
  const preview = [
    previewParts.join(" ").trim(),
    ...(template.includeLinks ? ["https://example.com/activity"] : []),
    template.suffixText.trim(),
  ]
    .filter(Boolean)
    .join("\n") || "#12";

  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-sm font-semibold text-slate-800">说说配文模板</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">正文在渲染图里，这里只改发布文案。</p>
        </div>
        <Badge variant={dirty ? "secondary" : "outline"}>{dirty ? "有改动" : "低频"}</Badge>
      </summary>
      <div className="border-t border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold leading-5 text-slate-500">按目标长期配置，日常发布无需调整。</p>
          <Button variant="outline" size="sm" disabled={busy || !dirty} onClick={saveTemplate}>
            保存模板
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-500">
            固定前缀，可留空
            <Textarea
              className="mt-1 min-h-20 resize-y bg-white text-sm"
              value={template.customText}
              onChange={(event) => updateTemplate({ customText: event.target.value })}
              placeholder="会显示在稿件编号和 @ 用户之前"
            />
          </label>
          <label className="text-xs font-semibold text-slate-500">
            固定后缀，可留空
            <Textarea
              className="mt-1 min-h-20 resize-y bg-white text-sm"
              value={template.suffixText}
              onChange={(event) => updateTemplate({ suffixText: event.target.value })}
              placeholder="会另起一行显示在正文链接之后"
            />
          </label>
        </div>
        <div className="mt-2 grid gap-2 text-xs font-bold text-slate-600 md:grid-cols-3">
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
            <input type="checkbox" checked={template.includePostId} onChange={(event) => updateTemplate({ includePostId: event.target.checked })} />
            稿件编号
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
            <input type="checkbox" checked={template.includeAuthorMention} onChange={(event) => updateTemplate({ includeAuthorMention: event.target.checked })} />
            非匿名时 @ 用户
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
            <input type="checkbox" checked={template.includeLinks} onChange={(event) => updateTemplate({ includeLinks: event.target.checked })} />
            提取正文链接
          </label>
        </div>
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
          <p className="text-[11px] font-bold text-slate-400">预览</p>
          <p className="mt-1 whitespace-pre-wrap text-xs font-semibold text-slate-700">{preview}</p>
        </div>
      </div>
    </details>
  );
}

function normalizePublishTemplate(template: PublishTextTemplate): PublishTextTemplate {
  return {
    customText: template.customText ?? "",
    suffixText: template.suffixText ?? "",
    includePostId: template.includePostId,
    includeAuthorMention: template.includeAuthorMention,
    includeLinks: template.includeLinks,
  };
}

function stringifyPublishTemplate(template: PublishTextTemplate) {
  return JSON.stringify(normalizePublishTemplate(template));
}

function BotMetric({ label, value, icon: Icon }: { label: string; value: string; icon?: LucideIcon }) {
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <p className="flex items-center gap-1 text-xs font-semibold text-slate-500">
        {Icon ? <Icon className="size-3.5" /> : null}
        {label}
      </p>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function PublishPanel({
  targets,
  attempts,
  bots,
  form,
  busy,
  onFormChange,
  onAdd,
  onToggleTarget,
  onPatchTarget,
  onRefreshQZone,
  onCheckQZone,
  onViewCookies,
  onRetry,
  onRefreshLogs,
  onSaveTemplate,
}: {
  targets: PublishTargetItem[];
  attempts: PublishAttemptItem[];
  bots: AdminBotAccount[];
  form: PublishTargetForm;
  busy: boolean;
  onFormChange: (form: PublishTargetForm) => void;
  onAdd: () => void;
  onToggleTarget: (target: PublishTargetItem) => void;
  onPatchTarget: (target: PublishTargetItem, patch: PublishTargetPatch) => void;
  onRefreshQZone: (botId: string, mode: "protocol" | "qr") => void;
  onCheckQZone: (botId: string) => void;
  onViewCookies: (botId: string) => void;
  onRetry: (id: string) => void;
  onRefreshLogs: () => void;
  onSaveTemplate: (botId: string, template: PublishTextTemplate) => void;
}) {
  const attemptGroups = groupPublishAttempts(attempts);

  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={ShieldCheckIcon} title="发布目标" description="管理墙号发布目标和失败重试" color="product-accent-rose" />

        <PublishSetupGuide hasBots={bots.length > 0} hasTargets={targets.length > 0} />

        <div className="product-subsection mt-4 grid gap-3 p-3">
          <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto]">
            <Select value={form.botAccountId || "none"} onValueChange={(botAccountId) => onFormChange({ ...form, botAccountId: botAccountId === "none" ? "" : botAccountId })}>
              <SelectTrigger className="h-10 w-full bg-white font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">选择机器人</SelectItem>
                {bots.map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>{bot.displayName} · {bot.qqUin}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="目标名称，例如 1 号墙 QZone" value={form.displayName} onChange={(event) => onFormChange({ ...form, displayName: event.target.value })} />
            <Button className="font-medium" disabled={busy || bots.length === 0 || form.displayName.trim().length === 0} onClick={onAdd}>
              <PlusIcon data-icon="inline-start" />
              添加发布目标
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-bold text-slate-500">高级选项：风控间隔、登录刷新方式、必需目标</summary>
            <div className="mt-2 grid gap-2 md:grid-cols-[150px_220px_minmax(0,1fr)] md:items-center">
              <Input
                inputMode="numeric"
                placeholder="风控间隔秒"
                value={form.publishDelaySeconds}
                onChange={(event) => onFormChange({ ...form, publishDelaySeconds: event.target.value.replace(/\D/g, "") })}
              />
              <Select value={form.qzoneRefreshMode} onValueChange={(qzoneRefreshMode) => onFormChange({ ...form, qzoneRefreshMode: qzoneRefreshMode as "protocol" | "qr" })}>
                <SelectTrigger className="h-10 w-full bg-white font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="protocol">协议自动获取登录态</SelectItem>
                  <SelectItem value="qr">扫码登录刷新登录态</SelectItem>
                </SelectContent>
              </Select>
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600">
                <input type="checkbox" checked={form.required} onChange={(event) => onFormChange({ ...form, required: event.target.checked })} />
                作为必需发布目标，失败时阻塞稿件完成
              </label>
            </div>
          </details>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {targets.length === 0 ? (
            <EmptyCard title="还没有发布目标，添加后审核通过的稿件会自动进入发布队列" />
          ) : (
            targets.map((target) => (
              <details key={target.id} className="product-row-card group overflow-hidden p-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{target.displayName}</p>
                      <Badge className={`rounded-full shadow-none ${target.required ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-slate-100 text-slate-600"}`}>{target.required ? "必需" : "可选"}</Badge>
                      <Badge className={`rounded-full shadow-none ${target.botAccount.enabled ? "bg-green-50 text-green-800 ring-1 ring-green-200" : "bg-slate-100 text-slate-500"}`}>{target.botAccount.enabled ? "机器人启用" : "机器人停用"}</Badge>
                      <Badge className={`rounded-full shadow-none ${sessionStatusBadgeClass(target.botAccount.qzoneSession?.status ?? "unchecked")}`}>登录态 {sessionStatusLabel(target.botAccount.qzoneSession?.status ?? "unchecked")}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {target.botAccount.displayName} · QQ {target.botAccount.qqUin}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      最近检测：{target.botAccount.qzoneSession?.checkedAt ? formatDateTime(target.botAccount.qzoneSession.checkedAt) : "未检测"}
                    </p>
                  </div>
                  <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 group-open:bg-slate-100">详情</span>
                </summary>
                <div className="border-t border-slate-100 bg-slate-50/70 p-3">
                  <div className="grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-4">
                    <InfoPill label="刷新模式" value={target.qzoneRefreshMode === "qr" ? "扫码登录" : "协议获取"} />
                    <InfoPill label="风控间隔" value={`${target.publishDelaySeconds}s`} />
                    <InfoPill label="最近刷新" value={target.botAccount.qzoneSession?.refreshedAt ? formatDateTime(target.botAccount.qzoneSession.refreshedAt) : "还没有登录态"} />
                    <InfoPill label="最近检测" value={target.botAccount.qzoneSession?.checkedAt ? formatDateTime(target.botAccount.qzoneSession.checkedAt) : "未检测"} />
                    <p className="rounded-md border border-slate-200 bg-white px-2 py-1.5 md:col-span-4">检测结果：{target.botAccount.qzoneSession?.message ?? "尚未检测空间登录态可用性"}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant={target.enabled ? "secondary" : "outline"} size="sm" onClick={() => onToggleTarget(target)}>
                      {target.enabled ? "启用中" : "已停用"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onPatchTarget(target, { required: !target.required })}>
                      {target.required ? "改为可选" : "设为必需"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onPatchTarget(target, { qzoneRefreshMode: target.qzoneRefreshMode === "qr" ? "protocol" : "qr" })}>
                      切换登录模式
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onCheckQZone(target.botAccount.id)}>
                      检测登录态
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onRefreshQZone(target.botAccount.id, target.qzoneRefreshMode)}>
                      重新登录
                    </Button>
                    <Button variant="outline" size="sm" disabled={!target.botAccount.qzoneSession} onClick={() => onViewCookies(target.botAccount.id)}>
                      查看登录态
                    </Button>
                  </div>
                  <PublishTargetConfigEditor target={target} busy={busy} onSave={(patch) => onPatchTarget(target, patch)} />
                  <BotPublishTemplateEditor
                    bot={{
                      id: target.botAccount.id,
                      qqUin: target.botAccount.qqUin,
                      displayName: target.botAccount.displayName,
                      enabled: target.botAccount.enabled,
                      reviewGroupId: null,
                      reviewNotificationEnabled: false,
                      autoFriendRequestApprovalEnabled: false,
                      connectionToken: target.botAccount.connectionToken,
                      publishTextTemplate: target.botAccount.publishTextTemplate,
                      userMessageReply: "",
                      userMessageReplyCooldownSeconds: 60,
                      reviewGroupMessageReply: "",
                      lastSeenAt: null,
                      createdAt: "",
                      connection: { online: false, connectionCount: 0 },
                      sessions: target.botAccount.qzoneSession ? [target.botAccount.qzoneSession] : [],
                      publishTargets: [],
                    }}
                    busy={busy}
                    onSave={(template) => onSaveTemplate(target.botAccount.id, template)}
                  />
                </div>
              </details>
            ))
          )}
        </div>

        <div className="product-subsection mt-4 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">最近发布详情</p>
            <Button variant="outline" size="sm" onClick={onRefreshLogs}>
              <RotateCcwIcon data-icon="inline-start" />
              刷新日志
            </Button>
          </div>
          {attemptGroups.length === 0 ? (
            <p className="mt-2 text-sm font-bold text-slate-500">还没有发布记录。</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {attemptGroups.map((group) => (
                <details key={group.post.id} className="product-row-card group overflow-hidden p-0 text-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">稿件 #{group.post.displayId}</span>
                        <Badge className={`rounded-full shadow-none ${publishAttemptBadgeClass(group.primaryStatus)}`}>{statusLabels[group.primaryStatus] ?? group.primaryStatus}</Badge>
                        <span className="text-xs font-bold text-slate-500">{group.attempts.length} 个发布目标</span>
                        <span className="text-xs font-bold text-slate-500">最近 {formatDateTime(group.updatedAt)}</span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-sm font-semibold text-slate-800">{group.post.text || "无正文"}</p>
                    </div>
                    <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 group-open:bg-slate-100">详情</span>
                  </summary>
                  <div className="border-t border-slate-100 bg-slate-50/70 p-3">
                    <div className="grid gap-1 text-xs font-semibold text-slate-500 md:grid-cols-2">
                      <p>作者：{group.post.anonymous ? "匿名投稿" : group.post.author.displayName ?? `QQ ${group.post.author.qqUin}`}</p>
                      <p>稿件状态：{statusLabels[group.post.status] ?? group.post.status}</p>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{group.post.text || "无正文"}</p>
                    <div className="mt-3 flex flex-col gap-2">
                      {group.attempts.map((attempt) => (
                        <PublishAttemptDetail key={attempt.id} attempt={attempt} onRetry={onRetry} />
                      ))}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PublishSetupGuide({ hasBots, hasTargets }: { hasBots: boolean; hasTargets: boolean }) {
  const steps = [
    {
      icon: BotIcon,
      title: "选择执行 Bot",
      detail: hasBots ? "选择已经接入 NapCat 的墙号机器人。" : "先到机器人页添加 Bot 并连接 NapCat。",
      done: hasBots,
    },
    {
      icon: ShieldCheckIcon,
      title: "创建发布目标",
      detail: "设置目标名称、必发策略和风控间隔。多个目标会按各自墙号排队发布。",
      done: hasTargets,
    },
    {
      icon: QrCodeIcon,
      title: "登录 QZone",
      detail: "优先使用扫码登录；协议获取登录态只在协议端支持时使用。登录后点击检测确认是否可用。",
      done: false,
    },
    {
      icon: CheckCircle2Icon,
      title: "观察发布日志",
      detail: "审核通过后发布日志会按稿件分组，展开可看每个目标的 HTTP 返回和错误。",
      done: false,
    },
  ];

  return (
    <details className="mt-4 rounded-md border border-rose-100 bg-rose-50/35">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-sm font-bold text-slate-950">从审核到发空间的配置顺序</p>
          <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-500">首次配置发布目标时展开查看。</p>
        </div>
        <Badge className="rounded-full bg-white text-rose-700 ring-1 ring-rose-200 shadow-none">帮助</Badge>
      </summary>
      <div className="grid gap-2 border-t border-rose-100 p-3 md:grid-cols-4">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="rounded-md bg-white p-2 ring-1 ring-rose-100">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-950">
                <Icon className={`size-4 ${step.done ? "text-green-600" : "text-rose-500"}`} />
                {step.title}
              </div>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{step.detail}</p>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function PublishTargetConfigEditor({
  target,
  busy,
  onSave,
}: {
  target: PublishTargetItem;
  busy: boolean;
  onSave: (patch: PublishTargetPatch) => void;
}) {
  const [displayName, setDisplayName] = useState(target.displayName);
  const [enabled, setEnabled] = useState(target.enabled);
  const [required, setRequired] = useState(target.required);
  const [publishDelaySeconds, setPublishDelaySeconds] = useState(String(target.publishDelaySeconds));
  const [qzoneRefreshMode, setQzoneRefreshMode] = useState<"protocol" | "qr">(target.qzoneRefreshMode);

  useEffect(() => {
    setDisplayName(target.displayName);
    setEnabled(target.enabled);
    setRequired(target.required);
    setPublishDelaySeconds(String(target.publishDelaySeconds));
    setQzoneRefreshMode(target.qzoneRefreshMode);
  }, [target.displayName, target.enabled, target.required, target.publishDelaySeconds, target.qzoneRefreshMode]);

  const normalizedDelay = Math.max(Number(publishDelaySeconds || DEFAULT_PUBLISH_INTERVAL_SECONDS), 0);
  const normalizedName = displayName.trim();
  const changed = normalizedName !== target.displayName
    || enabled !== target.enabled
    || required !== target.required
    || normalizedDelay !== target.publishDelaySeconds
    || qzoneRefreshMode !== target.qzoneRefreshMode;

  function saveConfig() {
    onSave({
      displayName: normalizedName,
      enabled,
      required,
      publishDelaySeconds: normalizedDelay,
      qzoneRefreshMode,
    });
  }

  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-sm font-semibold text-slate-800">目标设置</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">名称、启用状态、风控间隔、登录方式。</p>
        </div>
        <Badge variant={changed ? "secondary" : "outline"}>{changed ? "有改动" : "设置"}</Badge>
      </summary>
      <div className="border-t border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold leading-5 text-slate-500">这些参数通常在首次配置后很少改动。</p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !changed || normalizedName.length === 0}
            onClick={saveConfig}
          >
            <SaveIcon data-icon="inline-start" />
            保存目标设置
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(180px,1fr)_150px_180px]">
          <Input className="bg-white" placeholder="发布目标名称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <Input
            className="bg-white"
            inputMode="numeric"
            placeholder="风控间隔秒"
            value={publishDelaySeconds}
            onChange={(event) => setPublishDelaySeconds(event.target.value.replace(/\D/g, ""))}
          />
          <Select value={qzoneRefreshMode} onValueChange={(value) => setQzoneRefreshMode(value as "protocol" | "qr")}>
            <SelectTrigger className="h-10 w-full bg-white font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="protocol">协议自动获取登录态</SelectItem>
              <SelectItem value="qr">扫码登录刷新登录态</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            启用这个发布目标
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-2">
            <input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />
            失败时阻塞稿件完成
          </label>
        </div>
      </div>
    </details>
  );
}

function PublishAttemptDetail({ attempt, onRetry }: { attempt: PublishAttemptItem; onRetry: (id: string) => void }) {
  return (
    <details className="rounded-md border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`rounded-full shadow-none ${publishAttemptBadgeClass(attempt.status)}`}>{statusLabels[attempt.status] ?? attempt.status}</Badge>
          <span className="font-semibold text-slate-700">{attempt.publishTarget.displayName}</span>
          <span className="text-xs font-bold text-slate-500">第 {attempt.attempt} 次</span>
          <span className="text-xs font-bold text-slate-500">更新 {formatDateTime(attempt.updatedAt)}</span>
        </div>
        {attempt.status === "failed" ? (
          <Button size="sm" variant="outline" onClick={(event) => {
            event.preventDefault();
            onRetry(attempt.id);
          }}>
            <RotateCcwIcon data-icon="inline-start" />
            重试
          </Button>
        ) : <span className="text-xs font-bold text-slate-400">日志</span>}
      </summary>
      <div className="border-t border-slate-100 p-3">
        <div className="grid gap-1 text-xs font-semibold text-slate-500 md:grid-cols-2">
          <p>目标：{attempt.publishTarget.displayName}</p>
          <p>Bot：{attempt.publishTarget.botAccount.displayName} · QQ {attempt.publishTarget.botAccount.qqUin}</p>
          {attempt.qzoneTid ? <p className="break-all md:col-span-2">QZone TID：{attempt.qzoneTid}</p> : null}
          {attempt.externalId ? <p className="break-all md:col-span-2">外部 ID：{attempt.externalId}</p> : null}
          {attempt.nextRunAt ? <p className="font-bold text-amber-700 md:col-span-2">下次执行：{formatDateTime(attempt.nextRunAt)}</p> : null}
        </div>
        {attempt.lastError ? <p className="mt-2 break-all rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700">{attempt.lastError}</p> : null}
        {attempt.verbose ? <PublishVerboseLog verbose={attempt.verbose} /> : null}
      </div>
    </details>
  );
}

function PublishVerboseLog({ verbose }: { verbose: NonNullable<PublishAttemptItem["verbose"]> }) {
  const httpLogs = Array.isArray(verbose.http) ? verbose.http : [];

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="rounded-full bg-slate-100 text-slate-700 shadow-none">模式 {String(verbose.mode ?? "unknown")}</Badge>
        <Badge className="rounded-full bg-blue-50 text-blue-700 shadow-none ring-1 ring-blue-200">登录态 {String(verbose.cookieStatus ?? "unknown")}</Badge>
        <span className="text-xs font-bold text-slate-500">
          渲染图 {formatBytes(verbose.renderedBytes)} · 图片 {typeof verbose.imageCount === "number" ? verbose.imageCount : 0} 张
        </span>
        {verbose.publishedAt ? <span className="text-xs font-bold text-slate-500">发布 {formatDateTime(verbose.publishedAt)}</span> : null}
      </div>
      {verbose.note ? <p className="mt-2 text-xs font-semibold leading-5 text-amber-700">{verbose.note}</p> : null}
      <div className="mt-2 grid gap-2 text-xs font-semibold text-slate-500 md:grid-cols-2">
        <p>QQ：{verbose.uin ?? "未知"}</p>
        <p className="break-all">Cookie 名称：{verbose.cookieNames?.length ? verbose.cookieNames.join(", ") : "无"}</p>
      </div>

      {httpLogs.length === 0 ? (
        <p className="mt-3 text-xs font-bold text-slate-500">这条记录没有 HTTP 明细。</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {httpLogs.map((entry, index) => (
            <details key={`${entry.label}-${index}`} className="rounded-md border border-slate-200 bg-slate-50">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
                <span className="font-bold text-slate-700">{entry.label}</span>
                <span className="text-xs font-bold text-slate-500">
                  {entry.response ? `HTTP ${entry.response.status}` : entry.error ? "请求失败" : "无响应"}{entry.durationMs ? ` · ${entry.durationMs}ms` : ""}
                </span>
              </summary>
              <div className="border-t border-slate-200 p-3">
                <p className="break-all text-xs font-bold text-slate-600">
                  {entry.request.method} {entry.request.url}
                </p>
                <LogBlock title="请求头" value={entry.request.headers} />
                {entry.request.body ? <LogBlock title="请求参数" value={entry.request.body} /> : null}
                {entry.response ? (
                  <>
                    <LogBlock title="响应头" value={entry.response.headers ?? {}} />
                    {entry.response.parsed ? <LogBlock title="解析结果" value={entry.response.parsed} /> : null}
                    <LogBlock title="响应体" value={entry.response.body} />
                  </>
                ) : null}
                {entry.error ? <p className="mt-2 break-all rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700">{entry.error}</p> : null}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function LogBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-bold text-slate-400">{title}</p>
      <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white p-2 text-[11px] leading-5 text-slate-700">{formatLogValue(value)}</pre>
    </div>
  );
}

function PanelTitle({ icon: Icon, title, description, color, action }: { icon: LucideIcon; title: string; description: string; color: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className={`grid size-10 place-items-center rounded-md border ${color}`}>
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-base font-semibold text-slate-950">{title}</p>
          <p className="text-sm text-slate-600">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-xs font-bold text-slate-700">{value}</p>
    </div>
  );
}

function groupPublishAttempts(attempts: PublishAttemptItem[]) {
  const groups = new Map<string, { post: PublishAttemptItem["post"]; attempts: PublishAttemptItem[]; updatedAt: string; primaryStatus: string }>();
  for (const attempt of attempts) {
    const current = groups.get(attempt.post.id);
    if (!current) {
      groups.set(attempt.post.id, {
        post: attempt.post,
        attempts: [attempt],
        updatedAt: attempt.updatedAt,
        primaryStatus: attempt.status,
      });
      continue;
    }
    current.attempts.push(attempt);
    if (new Date(attempt.updatedAt).getTime() > new Date(current.updatedAt).getTime()) {
      current.updatedAt = attempt.updatedAt;
    }
    current.primaryStatus = summarizePublishAttemptStatus(current.attempts);
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      attempts: group.attempts.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
      primaryStatus: summarizePublishAttemptStatus(group.attempts),
    }))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function summarizePublishAttemptStatus(attempts: PublishAttemptItem[]) {
  if (attempts.some((attempt) => attempt.status === "failed")) return "failed";
  if (attempts.some((attempt) => attempt.status === "running")) return "running";
  if (attempts.some((attempt) => attempt.status === "waiting_cookies")) return "waiting_cookies";
  if (attempts.some((attempt) => attempt.status === "queued")) return "queued";
  if (attempts.every((attempt) => attempt.status === "succeeded")) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "skipped")) return "skipped";
  return attempts[0]?.status ?? "queued";
}

function toForm(selectedTenant: TenantSummary, metadata: TenantMetadata): TenantSettingsForm {
  return {
    tenantName: selectedTenant.name,
    slug: selectedTenant.slug,
    themeColor: selectedTenant.themeColor,
    brand: metadata.brand,
    banner: metadata.banner,
    logoUrl: metadata.logoUrl,
    pendingPostLimit: metadata.pendingPostLimit,
    postRulesText: metadata.postRules.join("\n"),
    servicesText: JSON.stringify(metadata.services, null, 2),
    imageCompressionEnabled: metadata.imageCompression.enabled,
    imageCompressionQuality: metadata.imageCompression.quality,
    imageCompressionMaxDimension: metadata.imageCompression.maxDimension,
    botStylishMessagesEnabled: metadata.botStylishMessagesEnabled,
    botPrivatePostStylishEnabled: metadata.botPrivatePostStylishEnabled,
    publishMode: metadata.publishMode,
    publishAccumulateMinImages: metadata.publishAccumulate.minImages,
    publishAccumulateMaxImages: metadata.publishAccumulate.maxImages,
    publishAccumulateStaleMinutes: metadata.publishAccumulate.staleMinutes,
    publishLlmSummaryEnabled: metadata.publishLlmSummaryEnabled,
    enableColorSelection: metadata.enableColorSelection,
    enableMarkdownRender: metadata.enableMarkdownRender,
  };
}

function aiSettingsToForm(settings: TenantAiSettings): AiSettingsForm {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    provider: settings.provider,
    baseUrl: settings.baseUrl ?? "",
    model: settings.model ?? "",
    apiKey: "",
    clearApiKey: false,
    temperature: settings.temperature,
    timeoutSeconds: settings.timeoutSeconds,
    tone: settings.rules.tone ?? "",
    strictPrivacy: Boolean(settings.rules.strictPrivacy),
    allowedCategoriesText: (settings.rules.allowedCategories ?? []).join("\n"),
    modelingKeywordsText: (settings.rules.modelingKeywords ?? []).join("\n"),
    modelingNotes: settings.rules.modelingNotes ?? "",
    postTriggerKeywordsText: (settings.rules.postTriggerKeywords ?? []).join("\n"),
  };
}

function lines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function defaultOAuthClientForm(): OAuthClientForm {
  return {
    name: "",
    description: "",
    redirectUrisText: "",
    scopesText: "profile",
    enabled: true,
    pkceRequired: true,
  };
}

function oauthClientToForm(client: OAuthClientItem): OAuthClientForm {
  return {
    name: client.name,
    description: client.description ?? "",
    redirectUrisText: client.redirectUris.join("\n"),
    scopesText: client.scopes.join("\n"),
    enabled: client.enabled,
    pkceRequired: client.pkceRequired,
  };
}

function defaultBanForm(): BanForm {
  const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    qqUin: "",
    comment: "",
    endsAt: toLocalDateTimeValue(endsAt),
  };
}

function defaultMemberForm(): MemberForm {
  return {
    qqUin: "",
    role: "submitter",
  };
}

function defaultBotForm(): BotForm {
  return {
    qqUin: "",
    displayName: "",
    reviewGroupId: "",
    createPublishTarget: true,
  };
}

function defaultPublishTargetForm(): PublishTargetForm {
  return {
    botAccountId: "",
    displayName: "",
    publishDelaySeconds: String(DEFAULT_PUBLISH_INTERVAL_SECONDS),
    required: true,
    qzoneRefreshMode: "protocol",
  };
}

function defaultPagination(): Pagination {
  return {
    page: 1,
    limit: 10,
    total: 0,
    pageCount: 1,
  };
}

function QqAvatar({ qqUin, name }: { qqUin: string; name: string }) {
  return (
    <img
      src={qqAvatarUrl(qqUin)}
      alt={name}
      className="size-10 shrink-0 rounded-full border border-slate-200 bg-slate-50 object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function qqAvatarUrl(qqUin: string) {
  return `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qqUin)}&s=100`;
}

function toLocalDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBanDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildOneBotConnectionUrl(bot: AdminBotAccount) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL("/onebot/v11/ws", `${protocol}//${window.location.host}`);
  url.searchParams.set("bot_id", bot.id);
  url.searchParams.set("token", bot.connectionToken);
  return url.toString();
}

function formatBytes(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatLogValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatBotEventAction(action: string) {
  const labels: Record<string, string> = {
    "bot_account.create": "添加机器人",
    "bot_account.delete": "删除机器人",
    "bot.register": "Bot 注册账号",
    "bot.membership.update": "Bot 更新授权",
    "bot.password.reset": "Bot 重置密码",
    "bot.review.approve": "群内通过",
    "bot.review.reject": "群内拒绝",
    "bot.qzone.cookies.refresh": "刷新空间登录态",
    "bot.qzone.cookies.auto_refresh": "自动刷新空间登录态",
    "bot.qzone.cookies.auto_refresh_failed": "自动刷新空间登录态失败",
    "publish_target.create": "创建发布目标",
    "publish_target.update": "更新发布目标",
    "publish_attempt.retry": "重试发布",
  };
  return labels[action] ?? action;
}

function publishAttemptBadgeClass(status: string) {
  const classes: Record<string, string> = {
    queued: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    running: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    waiting_cookies: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
    succeeded: "bg-green-50 text-green-800 ring-1 ring-green-200",
    failed: "bg-red-50 text-red-700 ring-1 ring-red-200",
    skipped: "bg-slate-100 text-slate-600",
  };
  return classes[status] ?? "bg-slate-100 text-slate-600";
}

function sessionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    unchecked: "未检测",
    available: "可用",
    invalid: "不可用",
    expired: "已过期",
  };
  return labels[status] ?? status;
}

function sessionStatusBadgeClass(status: string) {
  const classes: Record<string, string> = {
    unchecked: "bg-slate-100 text-slate-600",
    available: "bg-green-50 text-green-800 ring-1 ring-green-200",
    invalid: "bg-red-50 text-red-700 ring-1 ring-red-200",
    expired: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  };
  return classes[status] ?? "bg-slate-100 text-slate-600";
}
