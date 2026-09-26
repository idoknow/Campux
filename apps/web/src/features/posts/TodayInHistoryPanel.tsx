import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PublishedFeedItem } from "@/types/app";
import { EmptyCard, LoadingBlock } from "@/components/app/utility";

export type TodayInHistoryGroup = {
  year: number;
  items: PublishedFeedItem[];
};

type TodayInHistoryResponse = {
  date: string;
  targetMonth: number;
  targetDay: number;
  total: number;
  groups: TodayInHistoryGroup[];
};

export function TodayInHistoryPanel({
  renderItem,
}: {
  renderItem: (item: PublishedFeedItem) => React.ReactNode;
}) {
  const [data, setData] = useState<TodayInHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<TodayInHistoryResponse>("/api/posts/today-in-history")
      .then((response) => {
        if (cancelled) return;
        setData(response);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "加载失败，请稍后再试");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <LoadingBlock title="正在翻找历史上的今天..." />;
  }

  if (error) {
    return <EmptyCard title={error} />;
  }

  if (!data || data.groups.length === 0) {
    return (
      <EmptyCard title={`${data ? `${data.targetMonth} 月 ${data.targetDay} 日` : "今天"}还没有历史稿件，往年的今天这里会显示当年发布的稿件`} />
    );
  }

  return (
    <div className="grid gap-5">
      <p className="text-xs font-semibold text-slate-400">
        历史上的 {data.targetMonth} 月 {data.targetDay} 日 · 共 {data.total} 条
      </p>
      {data.groups.map((group) => (
        <section key={group.year} className="flex gap-3">
          {/* 年份大字：窄屏退回横排小字 */}
          <div className="hidden w-14 shrink-0 flex-col items-center border-r border-slate-200 pr-3 sm:flex">
            <span className="text-2xl font-black leading-none tracking-tight text-slate-900">{group.year}</span>
            <span className="mt-1 text-[11px] font-medium text-slate-400">{group.items.length} 条</span>
          </div>
          <div className="grid min-w-0 flex-1 gap-3">
            <div className="flex items-baseline gap-2 sm:hidden">
              <span className="text-xl font-black text-slate-900">{group.year}</span>
              <span className="text-[11px] text-slate-400">{group.items.length} 条</span>
            </div>
            {group.items.map((item) => (
              <div key={item.key}>{renderItem(item)}</div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
