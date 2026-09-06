import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { canAccess } from "@/lib/app-model";
import type { AuthenticatedMe, TenantMetadata } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type Campaign,
  type CampaignFilter,
  formatEndsAt,
  statusBadge,
} from "./campaign-types";

type CampaignWithAuthor = Campaign & { author?: { displayName: string | null; qqUin: string } | null };

const FILTERS: Array<{ value: CampaignFilter; label: string }> = [
  { value: "active", label: "进行中" },
  { value: "ending_soon", label: "快结束" },
  { value: "ended", label: "已结束" },
];

export function CampaignsPage({
  me,
  metadata,
  onSelect,
  initialFilter,
  initialKeyword,
}: {
  me: AuthenticatedMe;
  metadata: TenantMetadata;
  onSelect: (campaign: Campaign) => void;
  initialFilter?: CampaignFilter | undefined;
  initialKeyword?: string | undefined;
}) {
  const canReview = me.currentMembership ? canAccess(me.currentMembership.role, "reviewer") : false;
  const [filter, setFilter] = useState<CampaignFilter>(initialFilter ?? "active");
  const [keyword, setKeyword] = useState(initialKeyword ?? "");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<CampaignWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CampaignWithAuthor | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  function reload() {
    setLoading(true);
    const url = `/api/campaigns?filter=${filter}&page=${page}&limit=20${keyword.trim() ? `&q=${encodeURIComponent(keyword.trim())}` : ""}`;
    void api<{ items: Campaign[]; pagination: { total: number } }>(url).then((res) => {
      setItems(res.items as CampaignWithAuthor[]);
      setTotal(res.pagination.total);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, [filter, page, keyword]);

  async function approveCampaign(target: CampaignWithAuthor) {
    setActingId(target.id);
    try {
      await api(`/api/campaigns/${encodeURIComponent(target.id)}/approve`, { method: "POST" });
      toast.success("已通过该竞选");
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setActingId(null);
    }
  }

  async function submitReject() {
    if (!rejectTarget) return;
    if (rejectReason.trim().length === 0) {
      toast.error("必须填写拒绝理由");
      return;
    }
    setRejectBusy(true);
    try {
      await api(`/api/campaigns/${encodeURIComponent(rejectTarget.id)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      toast.success("已拒绝该竞选");
      setRejectTarget(null);
      setRejectReason("");
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setRejectBusy(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / 20));

  if (!metadata.enableCampaigns) {
    return <section className="product-surface p-4 text-sm text-slate-500">投票竞选插件尚未启用。</section>;
  }

  return (
    <section className="product-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">投票竞选</h2>
        <div className="flex items-center gap-1 rounded-full border border-slate-200 p-0.5 text-xs">
          {(canReview ? [...FILTERS, { value: "pending" as CampaignFilter, label: "待审核" }] : FILTERS).map((item) => (
            <button
              key={item.value}
              className={`rounded-full px-2.5 py-1 ${filter === item.value ? "bg-slate-900 text-white" : "text-slate-600"}`}
              onClick={() => { setFilter(item.value); setPage(1); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 relative">
        <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <Input
          placeholder="搜索竞选编号或标题"
          className="pl-8"
          value={keyword}
          onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
        />
      </div>
      <div className="mt-3 grid gap-2">
        {loading ? <p className="py-6 text-center text-sm text-slate-500">正在加载…</p> : items.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">暂无竞选。</p> : items.map((item) => {
          const badge = statusBadge(item.status);
          const showReviewActions = filter === "pending" && item.status === "pending_approval" && canReview;
          return (
            <div key={item.id} className="rounded-md border border-slate-200 bg-white shadow-none transition hover:border-slate-300">
              <button
                onClick={() => onSelect(item)}
                className="flex w-full items-center gap-3 p-3 text-left"
              >
                {item.coverAttachment ? (
                  <img src={item.coverAttachment.url} alt="" className="h-20 w-16 shrink-0 rounded-md border border-slate-200 object-cover" />
                ) : (
                  <span className="grid h-20 w-16 shrink-0 place-items-center rounded-md bg-gradient-to-br from-violet-100 to-fuchsia-100 text-xs font-semibold text-violet-400">投票竞选</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">#{item.displayId}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.text}</span>
                    {item.anonymous ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">匿名</span> : null}
                  </span>
                  <span className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-slate-900">{item.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{item.options.length} 个选项 · {formatEndsAt(item.endsAt)}</span>
                </span>
              </button>
              {showReviewActions ? (
                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-3 py-2">
                  <Button size="sm" variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" disabled={actingId === item.id} onClick={() => void approveCampaign(item)}>
                    {actingId === item.id ? "通过中..." : "通过"}
                  </Button>
                  <Button size="sm" variant="outline" className="border-rose-200 text-rose-600 hover:bg-rose-50" disabled={actingId === item.id} onClick={() => setRejectTarget(item)}>
                    拒绝
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
          <span>{page} / {pageCount}</span>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>下一页</Button>
        </div>
      ) : null}

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>拒绝竞选</DialogTitle>
            <DialogDescription>拒绝必须填写理由，发起人会收到拒绝原因。</DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <Textarea
              placeholder="填写拒绝理由..."
              value={rejectReason}
              rows={3}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={rejectBusy} onClick={() => { setRejectTarget(null); setRejectReason(""); }}>取消</Button>
            <Button variant="destructive" disabled={rejectBusy} onClick={() => void submitReject()}>
              {rejectBusy ? "提交中..." : "确认拒绝"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
