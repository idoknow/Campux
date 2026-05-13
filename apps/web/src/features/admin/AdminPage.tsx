import { useEffect, useMemo, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CheckIcon, ClipboardListIcon, MegaphoneIcon, RotateCcwIcon, SaveIcon, ShieldCheckIcon, UserRoundIcon, XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { roleLabels, statusLabels } from "@/lib/app-model";
import type { AdminBanRecord, AdminMember, PublishAttemptItem, PublishTargetItem, ReviewPostItem, TenantMetadata, TenantRole } from "@/types/app";
import { EmptyCard, SectionHeader } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const managementTabsListClassName = "grid !h-[60px] w-full items-stretch rounded-md bg-[#eef8ff] p-1.5 shadow-none";
const managementTabsTriggerClassName = "!h-full rounded-[6px] p-0 text-base font-bold shadow-none after:hidden data-active:text-white data-active:shadow-none";

export function AdminPage({
  currentRole,
  selectedTenant,
  metadata,
  onSaved,
}: {
  currentRole: TenantRole;
  selectedTenant: TenantSummary;
  metadata: TenantMetadata;
  onSaved: () => Promise<void>;
}) {
  const isAdmin = currentRole === "admin";
  const [form, setForm] = useState<TenantSettingsForm>(() => toForm(selectedTenant, metadata));
  const [reviewPosts, setReviewPosts] = useState<ReviewPostItem[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [targets, setTargets] = useState<PublishTargetItem[]>([]);
  const [attempts, setAttempts] = useState<PublishAttemptItem[]>([]);
  const [bans, setBans] = useState<AdminBanRecord[]>([]);
  const [memberKeyword, setMemberKeyword] = useState("");
  const [banKeyword, setBanKeyword] = useState("");
  const [onlyActiveBans, setOnlyActiveBans] = useState(true);
  const [banForm, setBanForm] = useState<BanForm>(() => defaultBanForm());
  const [activeTab, setActiveTab] = useState("review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
      setError(caught instanceof Error ? caught.message : "无法读取管理数据");
    });
  }, [selectedTenant.id, currentRole]);

  async function refreshAdminData() {
    const reviewData = await api<{ posts: ReviewPostItem[] }>("/api/review/posts");
    setReviewPosts(reviewData.posts);
    if (!isAdmin) {
      setMembers([]);
      setTargets([]);
      setBans([]);
      return;
    }

    const [memberData, targetData, banData] = await Promise.all([
      api<{ members: AdminMember[] }>("/api/admin/members"),
      api<{ targets: PublishTargetItem[] }>("/api/admin/publish-targets"),
      fetchBanRecords(),
    ]);
    setMembers(memberData.members);
    setTargets(targetData.targets);
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
    setError("");
    setNotice("");
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
      setNotice("元数据已保存。");
    } catch (caught) {
      setError(caught instanceof SyntaxError ? "服务入口 JSON 格式不正确" : caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function reviewPost(id: string, action: "approve" | "reject") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/review/posts/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(action === "approve" ? "已通过，正在生成发布任务。" : "已拒绝。");
      await refreshAdminData();
      const data = await api<{ attempts: PublishAttemptItem[] }>(`/api/admin/posts/${id}/publish-attempts`).catch(() => ({ attempts: [] }));
      setAttempts(data.attempts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审核失败");
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
    setError("");
    setNotice("");
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
      setNotice("用户已封禁。");
      await refreshBans();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "封禁失败");
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

  async function toggleTarget(target: PublishTargetItem) {
    await api(`/api/admin/publish-targets/${target.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !target.enabled }),
    });
    await refreshAdminData();
  }

  async function retryAttempt(id: string) {
    await api(`/api/admin/publish-attempts/${id}/retry`, {
      method: "POST",
    });
    setAttempts((current) => current.map((attempt) => (attempt.id === id ? { ...attempt, status: "queued", lastError: null } : attempt)));
  }

  return (
    <div className="px-4 pb-6">
      <SectionHeader title="管理" subtitle="审核、用户、封禁和校园墙配置" />

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</p> : null}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-3">
        <TabsList className={`${managementTabsListClassName} ${isAdmin ? "grid-cols-5" : "grid-cols-1"}`}>
          <TabsTrigger value="review" className={`${managementTabsTriggerClassName} data-active:bg-[#f8b94c]`}>
            审核
          </TabsTrigger>
          {isAdmin ? (
            <>
              <TabsTrigger value="users" className={`${managementTabsTriggerClassName} data-active:bg-[#42a5f5]`}>
                用户
              </TabsTrigger>
              <TabsTrigger value="bans" className={`${managementTabsTriggerClassName} data-active:bg-[#ff7d68]`}>
                封禁
              </TabsTrigger>
              <TabsTrigger value="metadata" className={`${managementTabsTriggerClassName} data-active:bg-[#8bc34a]`}>
                元数据
              </TabsTrigger>
              <TabsTrigger value="publish" className={`${managementTabsTriggerClassName} data-active:bg-[#ff7d9a]`}>
                发布
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>

        <TabsContent value="review" className="mt-4">
          <ReviewPanel posts={reviewPosts} onRefresh={() => void refreshAdminData()} onApprove={(id) => void reviewPost(id, "approve")} onReject={(id) => void reviewPost(id, "reject")} />
        </TabsContent>

        {isAdmin ? (
          <>
            <TabsContent value="users" className="mt-4">
              <UsersPanel
                members={filteredMembers}
                keyword={memberKeyword}
                onKeywordChange={setMemberKeyword}
                onRoleChange={(id, role) => void updateMemberRole(id, role)}
                onPrepareBan={(member) => {
                  setBanForm((current) => ({ ...current, userId: member.user.id }));
                  setActiveTab("bans");
                }}
              />
            </TabsContent>

            <TabsContent value="bans" className="mt-4">
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

            <TabsContent value="metadata" className="mt-4">
              <MetadataPanel form={form} busy={busy} onFormChange={setForm} onSave={() => void saveSettings()} />
            </TabsContent>

            <TabsContent value="publish" className="mt-4">
              <PublishPanel targets={targets} attempts={attempts} onToggleTarget={(target) => void toggleTarget(target)} onRetry={(id) => void retryAttempt(id)} />
            </TabsContent>
          </>
        ) : null}
      </Tabs>
    </div>
  );
}

function ReviewPanel({
  posts,
  onRefresh,
  onApprove,
  onReject,
}: {
  posts: ReviewPostItem[];
  onRefresh: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <Card className="rounded-md border-[#ffd596] bg-[#fff8e8] shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={ClipboardListIcon} title="审核队列" description={`${posts.length} 条待处理`} color="bg-[#f8b94c]" action={<Button variant="outline" size="sm" onClick={onRefresh}>刷新</Button>} />
        <div className="mt-3 flex flex-col gap-2">
          {posts.length === 0 ? (
            <EmptyCard title="暂时没有待审核稿件" />
          ) : (
            posts.map((post) => (
              <div key={post.id} className="rounded-md bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-500">
                      <span>#{post.displayId}</span>
                      <span>{post.anonymous ? "匿名投稿" : post.author?.displayName ?? post.author?.qqUin ?? "用户"}</span>
                      <Badge className="rounded-full bg-[#42a5f5] text-white shadow-none">{statusLabels[post.status] ?? post.status}</Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.text}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" className="bg-[#8bc34a] hover:bg-[#8bc34a]" onClick={() => onApprove(post.id)}>
                      <CheckIcon data-icon="inline-start" />
                      通过
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onReject(post.id)}>
                      <XIcon data-icon="inline-start" />
                      拒绝
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
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
    <Card className="rounded-md border-[#bceaff] bg-[#effaff] shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={UserRoundIcon} title="用户管理" description="搜索用户、调整角色或准备封禁" color="bg-[#42a5f5]" />
        <Input className="mt-3 bg-white" placeholder="输入 QQ 或昵称搜索" value={keyword} onChange={(event) => onKeywordChange(event.target.value)} />
        <div className="mt-3 flex flex-col gap-2">
          {members.map((member) => (
            <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white p-3">
              <div className="min-w-0">
                <p className="truncate font-black">{member.user.displayName ?? member.user.qqUin}</p>
                <p className="text-xs text-slate-500">{member.user.qqUin}</p>
              </div>
              <div className="flex items-center gap-2">
                <select value={member.role} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold" onChange={(event) => onRoleChange(member.id, event.target.value as TenantRole)}>
                  <option value="submitter">{roleLabels.submitter}</option>
                  <option value="reviewer">{roleLabels.reviewer}</option>
                  <option value="admin">{roleLabels.admin}</option>
                </select>
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
    <Card className="rounded-md border-[#ffc9d6] bg-[#fff0f4] shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={ShieldCheckIcon} title="封禁管理" description="查看封禁记录，或临时封禁用户" color="bg-[#ff7d68]" />
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <select className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm font-bold" value={form.userId} onChange={(event) => onFormChange({ ...form, userId: event.target.value })}>
            <option value="">选择用户</option>
            {members.filter((member) => member.role !== "admin").map((member) => (
              <option key={member.id} value={member.user.id}>
                {member.user.displayName ?? member.user.qqUin}
              </option>
            ))}
          </select>
          <Input className="bg-white" placeholder="封禁原因" value={form.comment} onChange={(event) => onFormChange({ ...form, comment: event.target.value })} />
          <Input className="bg-white" type="datetime-local" value={form.endsAt} onChange={(event) => onFormChange({ ...form, endsAt: event.target.value })} />
          <Button className="bg-[#ff7d68] font-bold hover:bg-[#ff7d68]" disabled={busy || !form.userId || !form.comment || !form.endsAt} onClick={onSubmit}>
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
              <div key={ban.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white p-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black">{ban.user?.displayName ?? ban.user?.qqUin ?? "未知用户"}</p>
                    <Badge className={`rounded-full shadow-none ${ban.active ? "bg-[#ff7d68] text-white" : "bg-slate-100 text-slate-500"}`}>
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
    <Card className="rounded-md border-[#d2efb9] bg-[#f6ffed] shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={MegaphoneIcon} title="元数据" description="校园墙名称、公告、投稿规则和服务入口" color="bg-[#8bc34a]" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            校园墙名称
            <Input className="border-white bg-white" value={form.tenantName} onChange={(event) => onFormChange({ ...form, tenantName: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            slug
            <Input className="border-white bg-white" value={form.slug} onChange={(event) => onFormChange({ ...form, slug: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            主题色
            <span className="flex items-center gap-2">
              <span className="h-9 w-9 rounded-[8px] border-2 border-white shadow-sm" style={{ backgroundColor: form.themeColor }} />
              <Input className="border-white bg-white" value={form.themeColor} onChange={(event) => onFormChange({ ...form, themeColor: event.target.value })} />
            </span>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            前台品牌名
            <Input className="border-white bg-white" value={form.brand} onChange={(event) => onFormChange({ ...form, brand: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            前台公告
            <Input className="border-white bg-white" value={form.banner} onChange={(event) => onFormChange({ ...form, banner: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            投稿规则，每行一条
            <Textarea className="min-h-32 border-white bg-white" value={form.postRulesText} onChange={(event) => onFormChange({ ...form, postRulesText: event.target.value })} />
          </label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            服务入口 JSON
            <Textarea className="min-h-36 border-white bg-white font-mono text-xs" value={form.servicesText} onChange={(event) => onFormChange({ ...form, servicesText: event.target.value })} />
          </label>
        </div>
        <Button className="mt-4 rounded-full bg-[#42a5f5] px-5 font-bold hover:bg-[#42a5f5]" disabled={busy} onClick={onSave}>
          <SaveIcon data-icon="inline-start" />
          保存元数据
        </Button>
      </CardContent>
    </Card>
  );
}

function PublishPanel({
  targets,
  attempts,
  onToggleTarget,
  onRetry,
}: {
  targets: PublishTargetItem[];
  attempts: PublishAttemptItem[];
  onToggleTarget: (target: PublishTargetItem) => void;
  onRetry: (id: string) => void;
}) {
  return (
    <Card className="rounded-md border-[#ffc9d6] bg-[#fff0f4] shadow-none">
      <CardContent className="p-4">
        <PanelTitle icon={ShieldCheckIcon} title="发布目标" description="管理墙号发布目标和失败重试" color="bg-[#ff7d9a]" />
        <div className="mt-3 flex flex-col gap-2">
          {targets.map((target) => (
            <div key={target.id} className="rounded-md bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-black">{target.displayName}</p>
                  <p className="text-xs text-slate-500">{target.botAccount.displayName} · {target.botAccount.qqUin}</p>
                </div>
                <Button variant={target.enabled ? "secondary" : "outline"} size="sm" onClick={() => onToggleTarget(target)}>
                  {target.enabled ? "启用中" : "已停用"}
                </Button>
              </div>
            </div>
          ))}
        </div>
        {attempts.length > 0 ? (
          <div className="mt-4 rounded-md bg-white p-3">
            <p className="font-black">最近发布详情</p>
            <div className="mt-2 flex flex-col gap-2">
              {attempts.map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{attempt.publishTarget.displayName}</span>
                  <span className="font-bold">{statusLabels[attempt.status] ?? attempt.status}</span>
                  {attempt.status === "failed" ? (
                    <Button size="sm" variant="outline" onClick={() => onRetry(attempt.id)}>
                      <RotateCcwIcon data-icon="inline-start" />
                      重试
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PanelTitle({ icon: Icon, title, description, color, action }: { icon: LucideIcon; title: string; description: string; color: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className={`grid size-10 place-items-center rounded-[10px] text-white ${color}`}>
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-lg font-black text-slate-950">{title}</p>
          <p className="text-sm text-slate-600">{description}</p>
        </div>
      </div>
      {action}
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
