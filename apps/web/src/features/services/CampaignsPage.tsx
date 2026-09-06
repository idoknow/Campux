import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { api } from "@/lib/api";
import { canAccess } from "@/lib/app-model";
import type { AuthenticatedMe, TenantMetadata } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  useEffect(() => {
    setLoading(true);
    const url = `/api/campaigns?filter=${filter}&page=${page}&limit=20${keyword.trim() ? `&q=${encodeURIComponent(keyword.trim())}` : ""}`;
    void api<{ items: Campaign[]; pagination: { total: number } }>(url).then((res) => {
      setItems(res.items as CampaignWithAuthor[]);
      setTotal(res.pagination.total);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [filter, page, keyword]);

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
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-left shadow-none transition hover:border-slate-300"
            >
              {item.coverAttachment ? <img src={item.coverAttachment.url} alt="" className="size-12 shrink-0 rounded object-cover" /> : <span className="grid size-12 shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-500">#{item.displayId}</span>}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">#{item.displayId}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.text}</span>
                  {item.anonymous ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">匿名</span> : null}
                </span>
                <span className="mt-1 block truncate text-sm font-medium text-slate-900">{item.title}</span>
                <span className="mt-1 block text-xs text-slate-500">{item.options.length} 个选项 · {formatEndsAt(item.endsAt)}</span>
              </span>
            </button>
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
    </section>
  );
}
