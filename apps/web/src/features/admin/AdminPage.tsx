import { useEffect, useMemo, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BotIcon, CopyIcon, MegaphoneIcon, PlusIcon, RotateCcwIcon, SaveIcon, ShieldCheckIcon, Trash2Icon, UserRoundIcon, WifiIcon, WifiOffIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { roleLabels, statusLabels } from "@/lib/app-model";
import type { AdminBanRecord, AdminBotAccount, AdminBotEvent, AdminMember, AdminTab, PublishAttemptItem, PublishTargetItem, TenantMetadata, TenantRole } from "@/types/app";
import { EmptyCard } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type TenantSettingsForm = {
  tenantName: string;
  slug: string;
  themeColor: string;
  brand: string;
  banner: string;
  postRulesText: string;
  servicesText: string;
};

type BanForm = {
  userId: string;
  comment: string;
  endsAt: string;
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

export function AdminPage({
  activeTab,
  selectedTenant,
  metadata,
  onTabChange,
  onSaved,
}: {
  activeTab: AdminTab;
  selectedTenant: TenantSummary;
  metadata: TenantMetadata;
  onTabChange: (tab: AdminTab) => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<TenantSettingsForm>(() => toForm(selectedTenant, metadata));
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [bots, setBots] = useState<AdminBotAccount[]>([]);
  const [botEvents, setBotEvents] = useState<AdminBotEvent[]>([]);
  const [targets, setTargets] = useState<PublishTargetItem[]>([]);
  const [attempts, setAttempts] = useState<PublishAttemptItem[]>([]);
  const [bans, setBans] = useState<AdminBanRecord[]>([]);
  const [memberKeyword, setMemberKeyword] = useState("");
  const [banKeyword, setBanKeyword] = useState("");
  const [onlyActiveBans, setOnlyActiveBans] = useState(true);
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

  const filteredMembers = useMemo(() => {
    const keyword = memberKeyword.trim().toLowerCase();
    if (!keyword) {
      return members;
    }

    return members.filter((member) => {
      const name = member.user.displayName?.toLowerCase() ?? "";
      return name.includes(keyword) || member.user.qqUin.includes(keyword);
    });
  }, [memberKeyword, members]);

  useEffect(() => {
    setForm(toForm(selectedTenant, metadata));
  }, [selectedTenant.id, selectedTenant.slug, selectedTenant.name, selectedTenant.themeColor, metadata.brand, metadata.banner, metadata.postRules, metadata.services]);

  useEffect(() => {
    void refreshAdminData().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取管理数据");
    });
  }, [selectedTenant.id]);

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
    if (!qzoneLogin.open || qzoneLogin.status !== "pending" || !qzoneLogin.botId || !qzoneLogin.loginId) {
      return;
    }
    const timer = window.setInterval(() => {
      void pollQZoneLogin();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [qzoneLogin.open, qzoneLogin.status, qzoneLogin.botId, qzoneLogin.loginId]);

  async function refreshAdminData() {
    const [memberData, botData, targetData, attemptData, banData] = await Promise.all([
      api<{ members: AdminMember[] }>("/api/admin/members"),
      api<{ bots: AdminBotAccount[]; events: AdminBotEvent[] }>("/api/admin/bots"),
      api<{ targets: PublishTargetItem[] }>("/api/admin/publish-targets"),
      api<{ attempts: PublishAttemptItem[] }>("/api/admin/publish-attempts?limit=20"),
      fetchBanRecords(),
    ]);
    setMembers(memberData.members);
    setBots(botData.bots);
    setBotEvents(botData.events);
    setTargets(targetData.targets);
    setAttempts(attemptData.attempts);
    setBans(banData.bans);
  }

  async function fetchBanRecords() {
    const params = new URLSearchParams({
      onlyActive: String(onlyActiveBans),
    });
    const keyword = banKeyword.trim();
    if (keyword.length > 0) {
      params.set("q", keyword);
    }
    return api<{ bans: AdminBanRecord[] }>(`/api/admin/ban-records?${params}`);
  }

  async function refreshBans() {
    const data = await fetchBanRecords();
    setBans(data.bans);
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
          postRules: form.postRulesText.split(/\r?\n/).map((rule) => rule.trim()).filter(Boolean),
          services: JSON.parse(form.servicesText) as TenantMetadata["services"],
        }),
      });
      await onSaved();
      toast.success("元数据已保存。");
    } catch (caught) {
      toast.error(caught instanceof SyntaxError ? "服务入口 JSON 格式不正确" : caught instanceof Error ? caught.message : "保存失败");
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

  async function banUser() {
    setBusy(true);
    try {
      await api("/api/admin/ban-records", {
        method: "POST",
        body: JSON.stringify({
          userId: banForm.userId,
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

  async function toggleTarget(target: PublishTargetItem) {
    await api(`/api/admin/publish-targets/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !target.enabled }),
    });
    await refreshAdminData();
  }

  async function patchTarget(target: PublishTargetItem, patch: Partial<Pick<PublishTargetItem, "enabled" | "required" | "publishDelaySeconds" | "qzoneRefreshMode">>) {
    await api(`/api/admin/publish-targets/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await refreshAdminData();
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
          publishDelaySeconds: Number(targetForm.publishDelaySeconds || 0),
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

  async function refreshQZoneCookies(botId: string, mode: "protocol" | "qr") {
    setBusy(true);
    try {
      if (mode === "protocol") {
        const data = await api<{ cookieNames: string[] }>(`/api/admin/bots/${botId}/qzone-cookies/protocol`, { method: "POST" });
        toast.success(`QZone cookies 已刷新（${data.cookieNames.length} 项）。`);
        await refreshAdminData();
        return;
      }
      const data = await api<{ id: string; qrImage: string; status: string; message: string | null }>(`/api/admin/bots/${botId}/qzone-login`, { method: "POST" });
      setQzoneLogin({ open: true, botId, loginId: data.id, qrImage: data.qrImage, status: data.status, message: data.message ?? "等待扫码" });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "刷新 QZone cookies 失败");
    } finally {
      setBusy(false);
    }
  }

  async function checkQZoneCookies(botId: string) {
    setBusy(true);
    try {
      const data = await api<{ session: { status: string; message: string | null } | null }>(`/api/admin/bots/${botId}/qzone-cookies/check`, { method: "POST" });
      toast.success(data.session ? `QZone cookies 检测完成：${sessionStatusLabel(data.session.status)}${data.session.message ? `，${data.session.message}` : ""}` : "这个 Bot 还没有 QZone cookies。");
      await refreshAdminData();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "检测 QZone cookies 失败");
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
      toast.error(caught instanceof Error ? caught.message : "读取 QZone cookies 失败");
    }
  }

  async function copyCookieHeader() {
    if (!cookieView.cookieHeader) {
      return;
    }
    await navigator.clipboard.writeText(cookieView.cookieHeader);
    toast.success("cookies 已复制。");
  }

  async function pollQZoneLogin() {
    if (!qzoneLogin.botId || !qzoneLogin.loginId) return;
    const data = await api<{ status: string; message: string | null; cookieNames: string[] }>(`/api/admin/bots/${qzoneLogin.botId}/qzone-login/${qzoneLogin.loginId}`);
    setQzoneLogin((current) => ({ ...current, status: data.status, message: data.message ?? current.message }));
    if (data.status === "succeeded") {
      toast.success(`扫码登录完成，QZone cookies 已刷新（${data.cookieNames.length} 项）。`);
      await refreshAdminData();
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
            元数据
          </TabsTrigger>
          <TabsTrigger value="bots" className={managementTabsTriggerClassName}>
            机器人
          </TabsTrigger>
          <TabsTrigger value="publish" className={managementTabsTriggerClassName}>
            发布
          </TabsTrigger>
        </TabsList>

            <TabsContent value="users" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <UsersPanel
                members={filteredMembers}
                keyword={memberKeyword}
                onKeywordChange={setMemberKeyword}
                onRoleChange={(id, role) => void updateMemberRole(id, role)}
                onPrepareBan={(member) => {
                  setBanForm((current) => ({ ...current, userId: member.user.id }));
                  onTabChange("bans");
                }}
              />
            </TabsContent>

            <TabsContent value="bans" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <BansPanel
                bans={bans}
                members={members}
                form={banForm}
                keyword={banKeyword}
                onlyActive={onlyActiveBans}
                busy={busy}
                onFormChange={setBanForm}
                onKeywordChange={setBanKeyword}
                onOnlyActiveChange={setOnlyActiveBans}
                onRefresh={() => void refreshBans()}
                onSubmit={() => void banUser()}
                onUnban={(id) => void unban(id)}
              />
            </TabsContent>

            <TabsContent value="metadata" className="mt-4 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <MetadataPanel form={form} busy={busy} onFormChange={setForm} onSave={() => void saveSettings()} />
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
                onRefresh={() => void refreshAdminData()}
                onRefreshQZone={(botId, mode) => void refreshQZoneCookies(botId, mode)}
                onCheckQZone={(botId) => void checkQZoneCookies(botId)}
                onViewCookies={(botId) => void viewQZoneCookies(botId)}
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
              />
            </TabsContent>
      </Tabs>
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
            <DialogTitle>QZone cookies</DialogTitle>
            <DialogDescription>{cookieView.botName || "读取当前发布目标的 QZone 登录态"}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 pb-5">
            {cookieView.loading ? (
              <p className="text-sm font-bold text-slate-500">正在读取...</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`rounded-full shadow-none ${sessionStatusBadgeClass(cookieView.status || "unchecked")}`}>cookies {sessionStatusLabel(cookieView.status || "unchecked")}</Badge>
                  <span className="text-xs font-bold text-slate-500">最近检测：{cookieView.checkedAt ? formatDateTime(cookieView.checkedAt) : "未检测"}</span>
                </div>
                <Textarea readOnly value={cookieView.cookieHeader} className="mt-3 min-h-28 resize-none bg-slate-50 font-mono text-xs" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void copyCookieHeader()} disabled={!cookieView.cookieHeader}>
                    <CopyIcon data-icon="inline-start" />
                    复制 cookies
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
  keyword,
  onKeywordChange,
  onRoleChange,
  onPrepareBan,
}: {
  members: AdminMember[];
  keyword: string;
  onKeywordChange: (value: string) => void;
  onRoleChange: (id: string, role: TenantRole) => void;
  onPrepareBan: (member: AdminMember) => void;
}) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={UserRoundIcon} title="用户管理" description="搜索用户、调整角色或准备封禁" color="product-accent-blue" />
        <Input className="mt-3 bg-white" placeholder="输入 QQ 或昵称搜索" value={keyword} onChange={(event) => onKeywordChange(event.target.value)} />
        <div className="mt-3 flex flex-col gap-2">
          {members.map((member) => (
            <div key={member.id} className="product-row-card flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{member.user.displayName ?? member.user.qqUin}</p>
                <p className="text-xs text-slate-500">{member.user.qqUin}</p>
              </div>
              <div className="flex items-center gap-2">
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
                <Button variant="outline" size="sm" onClick={() => onPrepareBan(member)}>
                  封禁
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BansPanel({
  bans,
  members,
  form,
  keyword,
  onlyActive,
  busy,
  onFormChange,
  onKeywordChange,
  onOnlyActiveChange,
  onRefresh,
  onSubmit,
  onUnban,
}: {
  bans: AdminBanRecord[];
  members: AdminMember[];
  form: BanForm;
  keyword: string;
  onlyActive: boolean;
  busy: boolean;
  onFormChange: (form: BanForm) => void;
  onKeywordChange: (value: string) => void;
  onOnlyActiveChange: (value: boolean) => void;
  onRefresh: () => void;
  onSubmit: () => void;
  onUnban: (id: string) => void;
}) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={ShieldCheckIcon} title="封禁管理" description="查看封禁记录，或临时封禁用户" color="product-accent-rose" />
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Select value={form.userId || "none"} onValueChange={(userId) => onFormChange({ ...form, userId: userId === "none" ? "" : userId })}>
            <SelectTrigger className="h-10 w-full bg-white font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">选择用户</SelectItem>
              {members.filter((member) => member.role !== "admin").map((member) => (
                <SelectItem key={member.id} value={member.user.id}>
                  {member.user.displayName ?? member.user.qqUin}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input className="bg-white" placeholder="封禁原因" value={form.comment} onChange={(event) => onFormChange({ ...form, comment: event.target.value })} />
          <Input className="bg-white" type="datetime-local" value={form.endsAt} onChange={(event) => onFormChange({ ...form, endsAt: event.target.value })} />
          <Button className="font-medium" variant="destructive" disabled={busy || !form.userId || !form.comment || !form.endsAt} onClick={onSubmit}>
            封禁
          </Button>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <Input className="bg-white" placeholder="按 QQ 或昵称筛选封禁记录" value={keyword} onChange={(event) => onKeywordChange(event.target.value)} />
          <label className="inline-flex items-center gap-2 rounded-md bg-white px-3 text-sm font-bold text-slate-600">
            <input type="checkbox" checked={onlyActive} onChange={(event) => onOnlyActiveChange(event.target.checked)} />
            仅生效中
          </label>
          <Button variant="outline" onClick={onRefresh}>
            查找
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {bans.length === 0 ? (
            <EmptyCard title="暂无封禁记录" />
          ) : (
            bans.map((ban) => (
            <div key={ban.id} className="product-row-card flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{ban.user?.displayName ?? ban.user?.qqUin ?? "未知用户"}</p>
                    <Badge className={`rounded-full shadow-none ${ban.active ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-slate-100 text-slate-500"}`}>
                      {ban.active ? "生效中" : "已结束"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{ban.comment}</p>
                  <p className="text-xs text-slate-500">结束时间：{formatDateTime(ban.endsAt)}</p>
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
      </CardContent>
    </Card>
  );
}

function MetadataPanel({ form, busy, onFormChange, onSave }: { form: TenantSettingsForm; busy: boolean; onFormChange: (form: TenantSettingsForm) => void; onSave: () => void }) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={MegaphoneIcon} title="元数据" description="校园墙名称、公告、投稿规则和服务入口" color="product-accent-green" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            校园墙名称
            <Input value={form.tenantName} onChange={(event) => onFormChange({ ...form, tenantName: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            slug
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
            <Input value={form.banner} onChange={(event) => onFormChange({ ...form, banner: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            投稿规则，每行一条
            <Textarea className="min-h-32" value={form.postRulesText} onChange={(event) => onFormChange({ ...form, postRulesText: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            服务入口 JSON
            <Textarea className="min-h-36 font-mono text-xs" value={form.servicesText} onChange={(event) => onFormChange({ ...form, servicesText: event.target.value })} />
          </label>
        </div>
        <Button className="mt-4 px-5 font-medium" disabled={busy} onClick={onSave}>
          <SaveIcon data-icon="inline-start" />
          保存元数据
        </Button>
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
  onRefresh,
  onRefreshQZone,
  onCheckQZone,
  onViewCookies,
}: {
  bots: AdminBotAccount[];
  events: AdminBotEvent[];
  form: BotForm;
  busy: boolean;
  onFormChange: (form: BotForm) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onRefreshQZone: (botId: string, mode: "protocol" | "qr") => void;
  onCheckQZone: (botId: string) => void;
  onViewCookies: (botId: string) => void;
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

        <div className="product-subsection mt-4 grid gap-2 p-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input placeholder="Bot QQ" value={form.qqUin} onChange={(event) => onFormChange({ ...form, qqUin: event.target.value })} />
          <Input placeholder="显示名，例如 1 号墙" value={form.displayName} onChange={(event) => onFormChange({ ...form, displayName: event.target.value })} />
          <Input placeholder="审核群号，可选" value={form.reviewGroupId} onChange={(event) => onFormChange({ ...form, reviewGroupId: event.target.value })} />
          <Button className="font-medium" disabled={busy || !form.qqUin.trim() || !form.displayName.trim()} onClick={onAdd}>
            <PlusIcon data-icon="inline-start" />
            添加
          </Button>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 md:col-span-4">
            <input type="checkbox" checked={form.createPublishTarget} onChange={(event) => onFormChange({ ...form, createPublishTarget: event.target.checked })} />
            同时创建一个发布目标
          </label>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {bots.length === 0 ? (
            <p className="text-sm font-bold text-slate-500">还没有绑定机器人。</p>
          ) : (
            bots.map((bot) => (
              <div key={bot.id} className="product-row-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold text-slate-950">{bot.displayName}</p>
                      <Badge className={`rounded-full shadow-none ${bot.connection.online ? "bg-green-50 text-green-800 ring-1 ring-green-200" : "bg-slate-100 text-slate-500"}`}>
                        {bot.connection.online ? "在线" : "离线"}
                      </Badge>
                      {!bot.enabled ? <Badge className="rounded-full bg-red-50 text-red-700 ring-1 ring-red-200 shadow-none">停用</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm font-bold text-slate-500">QQ {bot.qqUin}</p>
                    <p className="text-xs text-slate-500">审核群：{bot.reviewGroupId ?? "未设置"}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => onDelete(bot.id)}>
                    <Trash2Icon data-icon="inline-start" />
                    删除
                  </Button>
                </div>

                <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                  <BotMetric icon={bot.connection.online ? WifiIcon : WifiOffIcon} label="连接" value={bot.connection.online ? `${bot.connection.connectionCount} 条` : "未连接"} />
                  <BotMetric label="最近心跳" value={bot.lastSeenAt ? formatDateTime(bot.lastSeenAt) : "暂无"} />
                  <BotMetric label="发布目标" value={`${bot.publishTargets.length} 个`} />
                </div>

                <div className="product-subsection mt-3 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-500">QZone session</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => onCheckQZone(bot.id)}>检测</Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => onRefreshQZone(bot.id, "protocol")}>协议刷新</Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => onRefreshQZone(bot.id, "qr")}>扫码登录</Button>
                      <Button variant="outline" size="sm" disabled={busy || bot.sessions.length === 0} onClick={() => onViewCookies(bot.id)}>查看 cookies</Button>
                    </div>
                  </div>
                  {bot.sessions.length === 0 ? (
                    <p className="mt-1 text-sm font-bold text-slate-500">还没有刷新 cookies</p>
                  ) : (
                    bot.sessions.map((session) => (
                      <div key={session.id} className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                        <p className="text-sm font-bold text-slate-700">
                          {session.domain} · {sessionStatusLabel(session.status)}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-500">
                          刷新 {formatDateTime(session.refreshedAt)} · 检测 {session.checkedAt ? formatDateTime(session.checkedAt) : "未检测"}
                        </p>
                        {session.message ? <p className="mt-0.5 text-xs font-semibold text-slate-500">{session.message}</p> : null}
                      </div>
                    ))
                  )}
                </div>
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
}: {
  targets: PublishTargetItem[];
  attempts: PublishAttemptItem[];
  bots: AdminBotAccount[];
  form: PublishTargetForm;
  busy: boolean;
  onFormChange: (form: PublishTargetForm) => void;
  onAdd: () => void;
  onToggleTarget: (target: PublishTargetItem) => void;
  onPatchTarget: (target: PublishTargetItem, patch: Partial<Pick<PublishTargetItem, "enabled" | "required" | "publishDelaySeconds" | "qzoneRefreshMode">>) => void;
  onRefreshQZone: (botId: string, mode: "protocol" | "qr") => void;
  onCheckQZone: (botId: string) => void;
  onViewCookies: (botId: string) => void;
  onRetry: (id: string) => void;
}) {
  return (
    <Card className="rounded-md border-slate-200 bg-white shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={ShieldCheckIcon} title="发布目标" description="管理墙号发布目标和失败重试" color="product-accent-rose" />

        <div className="product-subsection mt-4 grid gap-2 p-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_110px_auto]">
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
          <Input
            inputMode="numeric"
            placeholder="延迟秒"
            value={form.publishDelaySeconds}
            onChange={(event) => onFormChange({ ...form, publishDelaySeconds: event.target.value.replace(/\D/g, "") })}
          />
          <Button className="font-medium" disabled={busy || bots.length === 0 || form.displayName.trim().length === 0} onClick={onAdd}>
            <PlusIcon data-icon="inline-start" />
            添加
          </Button>
          <Select value={form.qzoneRefreshMode} onValueChange={(qzoneRefreshMode) => onFormChange({ ...form, qzoneRefreshMode: qzoneRefreshMode as "protocol" | "qr" })}>
            <SelectTrigger className="h-10 w-full bg-white font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="protocol">协议自动获取 cookies</SelectItem>
              <SelectItem value="qr">扫码登录刷新 cookies</SelectItem>
            </SelectContent>
          </Select>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 md:col-span-3">
            <input type="checkbox" checked={form.required} onChange={(event) => onFormChange({ ...form, required: event.target.checked })} />
            作为必需发布目标，失败时阻塞稿件完成
          </label>
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
                      <Badge className={`rounded-full shadow-none ${target.botAccount.enabled ? "bg-green-50 text-green-800 ring-1 ring-green-200" : "bg-slate-100 text-slate-500"}`}>{target.botAccount.enabled ? "Bot 启用" : "Bot 停用"}</Badge>
                      <Badge className={`rounded-full shadow-none ${sessionStatusBadgeClass(target.botAccount.qzoneSession?.status ?? "unchecked")}`}>cookies {sessionStatusLabel(target.botAccount.qzoneSession?.status ?? "unchecked")}</Badge>
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
                    <InfoPill label="发布延迟" value={`${target.publishDelaySeconds}s`} />
                    <InfoPill label="最近刷新" value={target.botAccount.qzoneSession?.refreshedAt ? formatDateTime(target.botAccount.qzoneSession.refreshedAt) : "还没有 cookies"} />
                    <InfoPill label="最近检测" value={target.botAccount.qzoneSession?.checkedAt ? formatDateTime(target.botAccount.qzoneSession.checkedAt) : "未检测"} />
                    <p className="rounded-md border border-slate-200 bg-white px-2 py-1.5 md:col-span-4">检测结果：{target.botAccount.qzoneSession?.message ?? "尚未检测 QZone cookies 可用性"}</p>
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
                      检测 cookies
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onRefreshQZone(target.botAccount.id, target.qzoneRefreshMode)}>
                      重新登录
                    </Button>
                    <Button variant="outline" size="sm" disabled={!target.botAccount.qzoneSession} onClick={() => onViewCookies(target.botAccount.id)}>
                      查看 cookies
                    </Button>
                  </div>
                </div>
              </details>
            ))
          )}
        </div>

        <div className="product-subsection mt-4 p-3">
          <p className="font-semibold">最近发布详情</p>
          {attempts.length === 0 ? (
            <p className="mt-2 text-sm font-bold text-slate-500">还没有发布记录。</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {attempts.map((attempt) => (
                <details key={attempt.id} className="product-row-card group overflow-hidden p-0 text-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">稿件 #{attempt.post.displayId}</span>
                        <Badge className={`rounded-full shadow-none ${publishAttemptBadgeClass(attempt.status)}`}>{statusLabels[attempt.status] ?? attempt.status}</Badge>
                        <span className="text-xs font-bold text-slate-500">{attempt.publishTarget.displayName}</span>
                        <span className="text-xs font-bold text-slate-500">第 {attempt.attempt} 次</span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-sm font-semibold text-slate-800">{attempt.post.text || "无正文"}</p>
                      <p className="mt-1 text-xs text-slate-500">更新 {formatDateTime(attempt.updatedAt)}</p>
                    </div>
                    {attempt.status === "failed" ? (
                      <Button size="sm" variant="outline" onClick={() => onRetry(attempt.id)}>
                        <RotateCcwIcon data-icon="inline-start" />
                        重试
                      </Button>
                    ) : <span className="rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 group-open:bg-slate-100">详情</span>}
                  </summary>
                  <div className="border-t border-slate-100 bg-slate-50/70 p-3">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{attempt.post.text || "无正文"}</p>
                    <div className="mt-2 grid gap-1 text-xs font-semibold text-slate-500 md:grid-cols-2">
                      <p>作者：{attempt.post.anonymous ? "匿名投稿" : attempt.post.author.displayName ?? `QQ ${attempt.post.author.qqUin}`}</p>
                      <p>稿件状态：{statusLabels[attempt.post.status] ?? attempt.post.status}</p>
                      <p>目标：{attempt.publishTarget.displayName}</p>
                      <p>Bot：{attempt.publishTarget.botAccount.displayName} · QQ {attempt.publishTarget.botAccount.qqUin}</p>
                      {attempt.externalId ? <p className="break-all md:col-span-2">外部 ID：{attempt.externalId}</p> : null}
                      {attempt.nextRunAt ? <p className="font-bold text-amber-700 md:col-span-2">下次执行：{formatDateTime(attempt.nextRunAt)}</p> : null}
                    </div>
                    {attempt.lastError ? <p className="mt-2 break-all rounded-md bg-red-50 px-2 py-1 text-xs font-bold text-red-700">{attempt.lastError}</p> : null}
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

function toForm(selectedTenant: TenantSummary, metadata: TenantMetadata): TenantSettingsForm {
  return {
    tenantName: selectedTenant.name,
    slug: selectedTenant.slug,
    themeColor: selectedTenant.themeColor,
    brand: metadata.brand,
    banner: metadata.banner,
    postRulesText: metadata.postRules.join("\n"),
    servicesText: JSON.stringify(metadata.services, null, 2),
  };
}

function defaultBanForm(): BanForm {
  const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    userId: "",
    comment: "",
    endsAt: toLocalDateTimeValue(endsAt),
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
    publishDelaySeconds: "0",
    required: true,
    qzoneRefreshMode: "protocol",
  };
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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
    "bot.qzone.cookies.refresh": "刷新 QZone cookies",
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
