import { useCallback, useEffect, useState } from "react";
import { BellRingIcon, ClockIcon, HistoryIcon, MegaphoneIcon, PencilIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { canAccess } from "@/lib/app-model";
import type { AuthenticatedMe, BroadcastItem, BroadcastListResponse, BroadcastVersion, BroadcastVersionListResponse, TenantMetadata, TenantRole } from "@/types/app";
import { BroadcastIcon } from "./BroadcastIcon";
import { DateTimePicker } from "./DateTimePicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Scope = "active" | "history";

const PAGE_SIZE = 20;
const MAX_CONTENT_LENGTH = 500;
/** 过期后仍可点「已广播」的宽限，与后端 MARK_GRACE_MS 一致。 */
const MARK_GRACE_MS = 60 * 1000;

// 三色分组键与卡片着色键保持同一套判定：
// count=0 → 红（未通知）；modified → 橙（已修改）；count>0 且未修改 → 绿（已通知）。
type BroadcastBucket = 0 | 1 | 2;

function bucketOf(item: BroadcastItem): BroadcastBucket {
  return item.broadcastCount === 0 ? 0 : item.modified ? 1 : 2;
}

function bucketBadge(bucket: BroadcastBucket) {
  switch (bucket) {
    case 0:
      return { text: "未通知", className: "bg-rose-100 text-rose-700" };
    case 1:
      return { text: "已修改", className: "bg-orange-100 text-orange-700" };
    default:
      return { text: "已通知", className: "bg-emerald-100 text-emerald-700" };
  }
}

function bucketShell(bucket: BroadcastBucket) {
  switch (bucket) {
    case 0:
      return "border-rose-200 bg-rose-50/40";
    case 1:
      return "border-orange-200 bg-orange-50/40";
    default:
      return "border-emerald-200 bg-emerald-50/40";
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatEndsAt(value: string, now: string) {
  const diff = new Date(value).getTime() - new Date(now).getTime();
  if (diff <= 0) return "已结束";
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `还剩 ${days} 天`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `还剩 ${hours} 小时`;
  return `还剩 ${Math.max(1, Math.floor(diff / 60_000))} 分钟`;
}

function readEndsAtValue(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toLocalDateTimeValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function BroadcastsPage({ me, metadata }: { me: AuthenticatedMe; metadata: TenantMetadata }) {
  const role = me.currentMembership?.role;
  const canMarkBroadcast = role ? canAccess(role, "broadcaster") : false;
  const canRemove = role ? canAccess(role, "broadcaster") : false;

  const [scope, setScope] = useState<Scope>("active");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [total, setTotal] = useState(0);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmRemoveTarget, setConfirmRemoveTarget] = useState<BroadcastItem | null>(null);
  const [confirmBroadcastTarget, setConfirmBroadcastTarget] = useState<BroadcastItem | null>(null);
  const [editTarget, setEditTarget] = useState<BroadcastItem | null>(null);
  const [versionTarget, setVersionTarget] = useState<BroadcastItem | null>(null);
  const [versions, setVersions] = useState<BroadcastVersion[]>([]);

  function reload() {
    setLoading(true);
    const params = new URLSearchParams({ scope, page: String(page), limit: String(PAGE_SIZE) });
    if (keyword.trim()) params.set("q", keyword.trim());
    void api<BroadcastListResponse>(`/api/broadcasts?${params}`).then((res) => {
      setItems(res.items);
      setTotal(res.pagination.total);
      setNow(res.now);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, page, keyword]);

  async function markBroadcast() {
    if (!confirmBroadcastTarget) return;
    setActingId(confirmBroadcastTarget.id);
    try {
      const updated = await api<BroadcastItem>(`/api/broadcasts/${encodeURIComponent(confirmBroadcastTarget.id)}/broadcast`, { method: "POST" });
      toast.success(`已登记广播，当前 ${updated.broadcastCount} 次`);
      setConfirmBroadcastTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setActingId(null);
    }
  }

  async function confirmRemove() {
    if (!confirmRemoveTarget) return;
    setActingId(confirmRemoveTarget.id);
    try {
      await api(`/api/broadcasts/${encodeURIComponent(confirmRemoveTarget.id)}/remove`, { method: "POST" });
      toast.success("已违规删除该通知");
      setConfirmRemoveTarget(null);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setActingId(null);
    }
  }

  async function openVersions(target: BroadcastItem) {
    setVersions([]);
    setVersionTarget(target);
    try {
      const res = await api<BroadcastVersionListResponse>(`/api/broadcasts/${encodeURIComponent(target.id)}/versions`);
      setVersions(res.versions);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取历史版本失败");
    }
  }

  const activeTotal = items.length;
  void activeTotal;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="flex h-full min-h-0 flex-col p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md border border-slate-200 bg-slate-50">
            <BroadcastIcon className="size-5" />
          </span>
          <h2 className="text-sm font-semibold text-slate-950">广播通知</h2>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 text-xs">
          <button
            className={`rounded-full px-3 py-1.5 ${scope === "active" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            onClick={() => { setScope("active"); setPage(1); }}
          >
            新通知
          </button>
          <button
            className={`rounded-full px-3 py-1.5 ${scope === "history" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            onClick={() => { setScope("history"); setPage(1); }}
          >
            历史通知
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs leading-5 text-slate-500">
        {scope === "active"
          ? "尚未过时效的通知。未通知的标红排在最前，已修改的橙色居中，已通知的标绿。"
          : "已过期或未生效的通知，按发出时间从新到旧排列。"}
      </p>

      {scope === "history" ? (
        <div className="mt-3 relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input placeholder="搜索通知内容或编号" className="pl-8" value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} />
        </div>
      ) : null}

      {/* scrollbar-gutter 预留经典滚动条宽度，pr-2 给覆盖式滚动条（iOS/Android）留出避让空间，
          两者叠加保证移动端卡片右边框不会被滚动条压住。 */}
      <div className="mt-3 grid min-h-0 flex-1 content-start gap-2 overflow-y-auto overscroll-contain pb-24 pr-2 md:pr-1 md:pb-6 [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">正在加载…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {scope === "active" ? "暂无进行中的广播通知。" : "暂无历史通知。"}
          </p>
        ) : (
          items.map((item) => (
            <BroadcastCard
              key={item.id}
              item={item}
              now={now}
              myQqUin={me.user.qqUin}
              canMarkBroadcast={canMarkBroadcast}
              canRemove={canRemove}
              busyId={actingId}
              scope={scope}
              onMarkBroadcast={() => setConfirmBroadcastTarget(item)}
              onRemove={() => setConfirmRemoveTarget(item)}
              onEdit={() => setEditTarget(item)}
              onVersions={() => void openVersions(item)}
            />
          ))
        )}
      </div>

      {pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span>{page} / {pageCount}</span>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      ) : null}

      <Dialog open={confirmBroadcastTarget !== null} onOpenChange={(open) => !open && setConfirmBroadcastTarget(null)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>标记已广播</DialogTitle>
            <DialogDescription>
              确认你已经把这条通知手动发出去了？确认后广播次数加一。
            </DialogDescription>
          </DialogHeader>
          {confirmBroadcastTarget ? (
            <div className="px-5">
              <p className="line-clamp-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">{confirmBroadcastTarget.content}</p>
              <p className="mt-2 text-xs text-slate-500">
                当前 {confirmBroadcastTarget.broadcastCount} 次 → 确认后 {confirmBroadcastTarget.broadcastCount + 1} 次
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBroadcastTarget(null)}>取消</Button>
            <Button disabled={actingId === confirmBroadcastTarget?.id} onClick={() => void markBroadcast()}>
              确认已广播
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemoveTarget !== null} onOpenChange={(open) => !open && setConfirmRemoveTarget(null)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>确认违规删除？</DialogTitle>
            <DialogDescription>该通知将从广播列表中永久移除，且此操作不可撤销。</DialogDescription>
          </DialogHeader>
          {confirmRemoveTarget ? (
            <div className="px-5">
              <p className="line-clamp-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{confirmRemoveTarget.content}</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemoveTarget(null)}>取消</Button>
            <Button variant="destructive" disabled={actingId === confirmRemoveTarget?.id} onClick={() => void confirmRemove()}>
              确认违规删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <EditBroadcastDialog target={editTarget} presets={metadata.broadcastQuickPresets} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); reload(); }} />
      </Dialog>

      <Dialog open={versionTarget !== null} onOpenChange={(open) => !open && setVersionTarget(null)}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>{versionTarget ? `通知 #${versionTarget.displayId} 的历史版本` : "历史版本"}</DialogTitle>
            <DialogDescription>每次发布与修改各保留一条快照，广播次数为该版本的登记次数。</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto overscroll-contain pr-2 [scrollbar-gutter:stable]">
            {versions.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">暂无版本记录。</p>
            ) : (
              versions.map((version) => (
                <div key={version.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">版本 {version.version}</span>
                    <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      <BellRingIcon className="size-3" />广播 {version.broadcastCount} 次
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{version.content}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {version.version === 1 ? "发出" : "修改"}时间：{formatDateTime(version.changedAt)}
                  </p>
                  <p className="text-xs text-slate-500">结束时间：{formatDateTime(version.endsAt)}</p>
                  {version.changedBy ? <p className="mt-0.5 text-xs text-slate-400">操作人：{version.changedBy.displayName ?? version.changedBy.qqUin}</p> : null}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BroadcastCard({
  item,
  now,
  myQqUin,
  canMarkBroadcast,
  canRemove,
  busyId,
  scope,
  onMarkBroadcast,
  onRemove,
  onEdit,
  onVersions,
}: {
  item: BroadcastItem;
  now: string;
  scope: Scope;
  myQqUin: string;
  canMarkBroadcast: boolean;
  canRemove: boolean;
  busyId: string | null;
  onMarkBroadcast: () => void;
  onRemove: () => void;
  onEdit: () => void;
  onVersions: () => void;
}) {
  const bucket = bucketOf(item);
  const badge = bucketBadge(bucket);
  const authorQq = item.author?.qqUin ?? "";
  const authorName = item.author?.displayName ?? (authorQq ? `QQ ${authorQq}` : "匿名");
  const endsAtIso = new Date(item.endsAt).toISOString();
  const canEdit = scope === "active" && item.author && authorQq === myQqUin && endsAtIso > now;
  const canMarkThis = canMarkBroadcast && new Date(item.endsAt).getTime() + MARK_GRACE_MS >= new Date(now).getTime();

  return (
    <div style={{ borderWidth: "3px" }} className={`rounded-lg border bg-white shadow-sm transition hover:shadow-md ${bucketShell(bucket)}`}>
      <div className="flex gap-3 p-3">
        <AvatarCell qqUin={authorQq} name={authorName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">通知 #{item.displayId}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.text}</span>
            {item.broadcastCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                <BellRingIcon className="size-3" />{item.broadcastCount} 次
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                <MegaphoneIcon className="size-3" />未通知
              </span>
            )}
            {canEdit ? (
              <button className="inline-flex items-center gap-1 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 hover:bg-orange-200" onClick={onEdit}>
                <PencilIcon className="size-3" />修改
              </button>
            ) : null}
            <button className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50" onClick={onVersions}>
              <HistoryIcon className="size-3" />历史版本
            </button>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">{item.content}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>发出：{formatDateTime(item.createdAt)}</span>
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3" />结束：{formatDateTime(item.endsAt)}
            </span>
            {scope === "active" ? <span>{formatEndsAt(item.endsAt, now)}</span> : null}
          </div>
        </div>
      </div>

      {(canMarkThis || canRemove) ? (
        <div className="flex items-center justify-end gap-2 border-t border-slate-200/70 px-3 py-2">
          {canRemove ? (
            <Button size="sm" variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50" disabled={busyId === item.id} onClick={onRemove}>
              违规删除
            </Button>
          ) : null}
          {canMarkThis ? (
            <Button size="sm" variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" disabled={busyId === item.id} onClick={onMarkBroadcast}>
              已广播
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AvatarCell({ qqUin, name }: { qqUin: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = (name.trim().slice(0, 2) || "?").toUpperCase();
  if (!qqUin || failed) {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-500">
        {initials}
      </span>
    );
  }
  return (
    <img
      src={`https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qqUin)}&s=100`}
      alt={name}
      className="size-10 shrink-0 rounded-full border border-slate-200 bg-slate-50 object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function EditBroadcastDialog({ target, presets, onClose, onSaved }: { target: BroadcastItem | null; presets?: Array<{ label: string; minutes: number }>; onClose: () => void; onSaved: () => void }) {
  const [content, setContent] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);

  // 每次打开不同通知时重置表单。
  useEffect(() => {
    if (!target) return;
    setContent(target.content);
    setEndsAt(toLocalDateTimeValue(new Date(target.endsAt)));
  }, [target?.id]);

  async function save() {
    if (!target) return;
    const trimmed = content.trim();
    if (trimmed.length < 2) {
      toast.error("通知内容至少 2 个字");
      return;
    }
    const endsAtDate = readEndsAtValue(endsAt);
    if (!endsAtDate) {
      toast.error("结束时间格式无效");
      return;
    }
    if (endsAtDate.getTime() <= Date.now()) {
      toast.error("结束时间必须晚于当前时间");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/broadcasts/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ content: trimmed, endsAt: endsAtDate.toISOString() }),
      });
      toast.success("通知已修改，并新增一条历史版本");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="w-[min(480px,calc(100vw-32px))]">
      <DialogHeader>
        <DialogTitle>{target ? `修改通知 #${target.displayId}` : "修改通知"}</DialogTitle>
        <DialogDescription>修改后通知标记为「已修改」，并追加一条历史版本；原广播次数保留。</DialogDescription>
      </DialogHeader>
      {target ? (
        <div className="space-y-3 px-5">
          <Textarea value={content} maxLength={MAX_CONTENT_LENGTH} rows={4} onChange={(event) => setContent(event.target.value)} />
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <span className="block text-xs text-slate-600">时效结束时间</span>
            <DateTimePicker
              value={readEndsAtValue(endsAt)}
              onChange={(date) => setEndsAt(date ? toLocalDateTimeValue(date) : "")}
              presets={presets ?? []}
              disabled={busy}
              hint="最长 7 天，从发出时间起算"
            />
          </div>
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button disabled={busy || !target} onClick={() => void save()}>{busy ? "保存中" : "保存修改"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
