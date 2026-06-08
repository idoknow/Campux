import type { LucideIcon } from "lucide-react";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import type { Pagination } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function SectionHeader({
  title,
  subtitle,
  action,
  icon: Icon,
  onAction,
}: {
  title: string;
  subtitle: string;
  action?: string;
  icon?: typeof RefreshCwIcon;
  onAction?: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-normal text-slate-950">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action && Icon ? (
        <Button variant="outline" size="sm" onClick={() => void onAction?.()}>
          <Icon data-icon="inline-start" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

export function ListButton({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <Button variant="outline" className="h-auto justify-start gap-3 rounded-md p-3">
      <Icon data-icon="inline-start" />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRightIcon data-icon="inline-end" />
    </Button>
  );
}

export function EmptyCard({ title }: { title: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-sm font-bold text-slate-500">{title}</div>
  );
}

export function LoadingBlock({ title = "正在加载..." }: { title?: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm font-bold text-slate-500">
      <span className="size-7 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />
      <span>{title}</span>
    </div>
  );
}

function buildPageItems(current: number, pageCount: number): (number | "ellipsis-start" | "ellipsis-end")[] {
  // 直接全部展开的阈值，避免页数不多时还要省略号
  if (pageCount <= 9) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const items: (number | "ellipsis-start" | "ellipsis-end")[] = [1];
  // 当前页左右各显示 2 个，配合首尾共最多 ~7 个可点页码
  const start = Math.max(2, current - 2);
  const end = Math.min(pageCount - 1, current + 2);
  if (start > 2) {
    items.push("ellipsis-start");
  }
  for (let page = start; page <= end; page += 1) {
    items.push(page);
  }
  if (end < pageCount - 1) {
    items.push("ellipsis-end");
  }
  items.push(pageCount);
  return items;
}

export function PaginationControls({
  pagination,
  busy,
  onPageChange,
}: {
  pagination: Pagination;
  busy?: boolean;
  onPageChange: (page: number) => void;
}) {
  const { page, pageCount } = pagination;
  const pageItems = pageCount > 1 ? buildPageItems(page, pageCount) : [];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs font-bold text-slate-500">
      <span>
        第 {page} / {pageCount} 页，共 {pagination.total} 条
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="outline" size="sm" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>
          上一页
        </Button>
        {pageItems.map((item) =>
          typeof item === "number" ? (
            <Button
              key={item}
              variant={item === page ? "default" : "outline"}
              size="sm"
              className="min-w-9 px-2"
              disabled={busy || item === page}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ) : (
            <span key={item} className="px-1 text-slate-400 select-none">
              …
            </span>
          ),
        )}
        <Button variant="outline" size="sm" disabled={busy || page >= pageCount} onClick={() => onPageChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}
