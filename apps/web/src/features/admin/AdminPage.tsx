import { useEffect, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import { CheckIcon, ClipboardListIcon, MegaphoneIcon, PaletteIcon, RotateCcwIcon, SaveIcon, ShieldCheckIcon, UserRoundIcon, XIcon } from "lucide-react";
import { api } from "@/lib/api";
import { roleLabels, statusLabels } from "@/lib/app-model";
import type { AdminMember, PublishAttemptItem, PublishTargetItem, ReviewPostItem, TenantMetadata, TenantRole } from "@/types/app";
import { EmptyCard, SectionHeader } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TenantSettingsForm = {
  tenantName: string;
  slug: string;
  themeColor: string;
  brand: string;
  banner: string;
};

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
  const [form, setForm] = useState<TenantSettingsForm>(() => toForm(selectedTenant, metadata));
  const [reviewPosts, setReviewPosts] = useState<ReviewPostItem[]>([]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [targets, setTargets] = useState<PublishTargetItem[]>([]);
  const [attempts, setAttempts] = useState<PublishAttemptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const isAdmin = currentRole === "admin";

  useEffect(() => {
    setForm(toForm(selectedTenant, metadata));
  }, [selectedTenant.id, metadata.brand, metadata.banner]);

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
      return;
    }

    const [memberData, targetData] = await Promise.all([
      api<{ members: AdminMember[] }>("/api/admin/members"),
      api<{ targets: PublishTargetItem[] }>("/api/admin/publish-targets"),
    ]);
    setMembers(memberData.members);
    setTargets(targetData.targets);
  }

  async function saveSettings() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/admin/tenant/metadata", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      await onSaved();
      setNotice("校园墙信息已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pb-6">
      <SectionHeader title="管理" subtitle="把校园墙打理得更顺手" />

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</p> : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <AdminShortcut
          title="审核稿件"
          description={`${selectedTenant.pendingPostCount} 条待审核`}
          badge={selectedTenant.pendingPostCount > 0 ? "去看看" : "清爽"}
          icon={ClipboardListIcon}
          className="border-[#ffd596] bg-[#fff8e8]"
          iconClassName="bg-[#f8b94c] text-white"
        />
        <AdminShortcut
          title="发布目标"
          description={`${selectedTenant.botAccountCount} 个 QQ 墙号`}
          badge="同步中"
          icon={ShieldCheckIcon}
          className="border-[#bceaff] bg-[#effaff]"
          iconClassName="bg-[#42a5f5] text-white"
        />
      </div>

      <Card className="mt-4 rounded-md border-[#ffd596] bg-[#fff8e8] shadow-none">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-10 place-items-center rounded-[10px] bg-[#f8b94c] text-white">
                <ClipboardListIcon className="size-5" />
              </span>
              <div>
                <p className="text-lg font-black text-slate-950">审核队列</p>
                <p className="text-sm text-slate-600">{reviewPosts.length} 条待处理</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshAdminData()}>
              刷新
            </Button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {reviewPosts.length === 0 ? (
              <EmptyCard title="暂时没有待审核稿件" />
            ) : (
              reviewPosts.map((post) => (
                <div key={post.id} className="rounded-md bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-500">
                        <span>#{post.displayId}</span>
                        <span>{post.anonymous ? "匿名投稿" : post.author?.displayName ?? post.author?.qqUin ?? "投稿者"}</span>
                        <Badge className="rounded-full bg-[#42a5f5] text-white shadow-none">{statusLabels[post.status] ?? post.status}</Badge>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.text}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" className="bg-[#8bc34a] hover:bg-[#8bc34a]" onClick={() => void reviewPost(post.id, "approve")}>
                        <CheckIcon data-icon="inline-start" />
                        通过
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void reviewPost(post.id, "reject")}>
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

      {isAdmin ? (
        <Card className="mt-4 rounded-md border-[#d2efb9] bg-[#f6ffed] shadow-none">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="grid size-10 place-items-center rounded-[10px] bg-[#8bc34a] text-white">
                <MegaphoneIcon className="size-5" />
              </span>
              <div>
                <p className="text-lg font-black text-slate-950">校园墙设置</p>
                <p className="text-sm text-slate-600">前台名字、公告和颜色都在这里改。</p>
              </div>
            </div>
            <span className="hidden items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-xs font-black text-slate-600 sm:inline-flex">
              <PaletteIcon className="size-3.5" />
              {form.themeColor}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              校园墙名称
              <Input className="border-white bg-white" value={form.tenantName} onChange={(event) => setForm({ ...form, tenantName: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              slug
              <Input className="border-white bg-white" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              主题色
              <span className="flex items-center gap-2">
                <span className="h-9 w-9 rounded-[8px] border-2 border-white shadow-sm" style={{ backgroundColor: form.themeColor }} />
                <Input className="border-white bg-white" value={form.themeColor} onChange={(event) => setForm({ ...form, themeColor: event.target.value })} />
              </span>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              前台品牌名
              <Input className="border-white bg-white" value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              前台公告
              <Input className="border-white bg-white" value={form.banner} onChange={(event) => setForm({ ...form, banner: event.target.value })} />
            </label>
          </div>

          <Button className="mt-4 rounded-full bg-[#42a5f5] px-5 font-bold hover:bg-[#42a5f5]" disabled={busy} onClick={() => void saveSettings()}>
            <SaveIcon data-icon="inline-start" />
            保存设置
          </Button>
        </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="rounded-md border-[#bceaff] bg-[#effaff] shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <UserRoundIcon className="size-5 text-[#42a5f5]" />
                <p className="text-lg font-black">成员</p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-2 rounded-md bg-white p-3">
                    <div className="min-w-0">
                      <p className="truncate font-black">{member.user.displayName ?? member.user.qqUin}</p>
                      <p className="text-xs text-slate-500">{member.user.qqUin}</p>
                    </div>
                    <select
                      value={member.role}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-bold"
                      onChange={(event) => void updateMemberRole(member.id, event.target.value as TenantRole)}
                    >
                      <option value="submitter">{roleLabels.submitter}</option>
                      <option value="reviewer">{roleLabels.reviewer}</option>
                      <option value="admin">{roleLabels.admin}</option>
                    </select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-md border-[#ffc9d6] bg-[#fff0f4] shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="size-5 text-[#ff7d9a]" />
                <p className="text-lg font-black">发布目标</p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {targets.map((target) => (
                  <div key={target.id} className="rounded-md bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-black">{target.displayName}</p>
                        <p className="text-xs text-slate-500">{target.botAccount.displayName} · {target.botAccount.qqUin}</p>
                      </div>
                      <Button variant={target.enabled ? "secondary" : "outline"} size="sm" onClick={() => void toggleTarget(target)}>
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
                          <Button size="sm" variant="outline" onClick={() => void retryAttempt(attempt.id)}>
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
        </div>
      ) : null}
    </div>
  );

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
}

function AdminShortcut({
  title,
  description,
  badge,
  icon: Icon,
  className,
  iconClassName,
}: {
  title: string;
  description: string;
  badge: string;
  icon: typeof ClipboardListIcon;
  className: string;
  iconClassName: string;
}) {
  return (
    <div className={`flex min-h-24 items-center gap-3 rounded-md border p-3 shadow-none ${className}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[10px] ${iconClassName}`}>
        <Icon className="size-6" strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-black text-slate-950">{title}</span>
        <span className="mt-0.5 block text-sm text-slate-600">{description}</span>
      </span>
      <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-black text-slate-600">{badge}</span>
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
  };
}
