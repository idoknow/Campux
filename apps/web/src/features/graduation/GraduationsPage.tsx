import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, Building2Icon, GraduationCapIcon, MapIcon, SearchIcon, UsersIcon } from "lucide-react";
import { api } from "@/lib/api";
import { canAccess } from "@/lib/app-model";
import type { AuthenticatedMe } from "@/types/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GraduationIcon } from "./GraduationIcon";

type GraduationItem = {
  id: string;
  displayId: number;
  classYear: number;
  graduationYear: number;
  education: string;
  destination: string;
  status: "pending_approval" | "approved" | "rejected";
  rejectReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  author: { displayName: string | null; qqUin: string } | null;
};

type SchoolEntry = {
  destination: string;
  count: number;
  earliestGraduationYear: number | null;
  latestGraduationYear: number | null;
};

type View = "users" | "schools" | "timeline" | "search" | "pending" | "map";

type TimelineBy = "graduationYear" | "classYear" | "createdAt";
type TimelineOrder = "asc" | "desc";
type YearType = "graduationYear" | "classYear";

function qqAvatar(qqUin: string) {
  // 与全站其他 QQ 头像一致：q1 子域 + no-referrer 防盗链，否则请求带 Referer 会被 qlogo CDN 拒绝。
  return `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qqUin)}&s=100`;
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().slice(0, 1).toUpperCase();
}

const VIEW_TABS: Array<{ key: View; label: string; icon: typeof UsersIcon }> = [
  { key: "users", label: "用户列表", icon: UsersIcon },
  { key: "schools", label: "学校列表", icon: Building2Icon },
  { key: "timeline", label: "时间视图", icon: GraduationCapIcon },
  { key: "search", label: "搜索", icon: SearchIcon },
  { key: "pending", label: "待审核", icon: UsersIcon },
  { key: "map", label: "地图", icon: MapIcon },
];

// 各视图按用途只展示单一状态的记录（用户列表/学校/时间/搜索均为已通过，待审核视图为待审核），
// 卡片上不再重复展示状态徽章。

export function GraduationsPage({ me }: { me: AuthenticatedMe }) {
  const canReview = me.currentMembership ? canAccess(me.currentMembership.role, "reviewer") : false;
  const [view, setView] = useState<View>("users");
  const [items, setItems] = useState<GraduationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [schools, setSchools] = useState<SchoolEntry[]>([]);
  const [schoolDetail, setSchoolDetail] = useState<{ destination: string; items: GraduationItem[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [timelineBy, setTimelineBy] = useState<TimelineBy>("graduationYear");
  const [timelineOrder, setTimelineOrder] = useState<TimelineOrder>("asc");
  const [timelineYear, setTimelineYear] = useState<number | "">("");
  const [timelineYearType, setTimelineYearType] = useState<YearType>("graduationYear");
  const [loading, setLoading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [rejectTarget, setRejectTarget] = useState<GraduationItem | null>(null);

  useEffect(() => {
    if (!canReview && view === "pending") setView("users");
  }, [canReview, view]);

  // 切换视图时重置学校详情
  useEffect(() => {
    setSchoolDetail(null);
  }, [view]);

  // 用户列表
  useEffect(() => {
    if (view !== "users") return;
    let cancelled = false;
    setLoading(true);
    api<{ items: GraduationItem[]; total: number }>("/api/graduations?onlyApproved=true&limit=200")
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view]);

  // 学校列表
  useEffect(() => {
    if (view !== "schools") return;
    let cancelled = false;
    setLoading(true);
    api<{ items: SchoolEntry[] }>("/api/graduations/schools")
      .then((res) => { if (!cancelled) setSchools(res.items); })
      .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view]);

  // 时间视图
  useEffect(() => {
    if (view !== "timeline") return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ by: timelineBy, order: timelineOrder, yearType: timelineYearType });
    if (timelineYear !== "") params.set("year", String(timelineYear));
    api<{ items: GraduationItem[] }>(`/api/graduations/timeline?${params.toString()}`)
      .then((res) => { if (!cancelled) setItems(res.items); })
      .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, timelineBy, timelineOrder, timelineYear, timelineYearType]);

  // 搜索（防抖 300ms）
  useEffect(() => {
    if (view !== "search") return;
    const query = searchQuery.trim();
    if (!query) { setItems([]); return; }
    const timer = setTimeout(() => {
      let cancelled = false;
      setLoading(true);
      api<{ items: GraduationItem[] }>(`/api/graduations/search?q=${encodeURIComponent(query)}`)
        .then((res) => { if (!cancelled) setItems(res.items); })
        .catch((error) => toast.error(error instanceof Error ? error.message : "搜索失败"))
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, 300);
    return () => { clearTimeout(timer); };
  }, [view, searchQuery]);

  // 待审核
  useEffect(() => {
    if (view !== "pending" || !canReview) return;
    let cancelled = false;
    // 审核可能发生在其他入口（如审核群），已打开的队列不会自动感知；
    // 用定时轮询 + 窗口焦点回归重取，保证已审核的毕业不再留在队列里。
    const load = () => {
      setLoading(true);
      api<{ items: GraduationItem[] }>("/api/graduations/pending")
        .then((res) => { if (!cancelled) setItems(res.items); })
        .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const timer = setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [view, canReview]);

  async function reload() {
    setRefreshCounter((n) => n + 1);
  }

  // 审核操作后重新拉取当前视图数据
  useEffect(() => {
    if (refreshCounter === 0) return;
    if (view === "users") {
      let cancelled = false;
      setLoading(true);
      api<{ items: GraduationItem[]; total: number }>("/api/graduations?onlyApproved=true&limit=200")
        .then((res) => { if (!cancelled) { setItems(res.items); setTotal(res.total); } })
        .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (view === "schools") {
      let cancelled = false;
      setLoading(true);
      api<{ items: SchoolEntry[] }>("/api/graduations/schools")
        .then((res) => { if (!cancelled) setSchools(res.items); })
        .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (view === "pending" && canReview) {
      let cancelled = false;
      setLoading(true);
      api<{ items: GraduationItem[] }>("/api/graduations/pending")
        .then((res) => { if (!cancelled) setItems(res.items); })
        .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    return undefined;
  }, [refreshCounter, view, canReview]);

  async function approve(target: GraduationItem) {
    try {
      await api(`/api/graduations/${encodeURIComponent(target.id)}/approve`, { method: "POST" });
      toast.success(`已通过毕业去向 #${target.displayId}`);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  async function submitReject(target: GraduationItem, reason: string) {
    await api(`/api/graduations/${encodeURIComponent(target.id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    toast.success(`已驳回毕业去向 #${target.displayId}`);
    reload();
  }

  async function openSchool(destination: string) {
    try {
      const res = await api<{ items: GraduationItem[] }>(`/api/graduations/schools/${encodeURIComponent(destination)}`);
      setSchoolDetail({ destination, items: res.items });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载失败");
    }
  }

  const buckets = useMemo(() => {
    if (timelineBy === "createdAt") return [];
    const map = new Map<number, number>();
    for (const item of items) {
      const year = timelineBy === "graduationYear" ? item.graduationYear : item.classYear;
      map.set(year, (map.get(year) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year);
  }, [items, timelineBy]);

  // 顶部横幅上的统计徽标：仅展示当前视图对应的计数
  const statBadge = view === "users"
    ? { label: "已填写", value: total, icon: UsersIcon }
    : view === "schools" && !schoolDetail
      ? { label: "学校", value: schools.length, icon: Building2Icon }
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-28 pt-5 pr-2 md:pb-8">
        {/* 顶部渐变横幅 */}
        <div className="relative overflow-hidden rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50 via-fuchsia-50 to-pink-100 p-6 shadow-sm dark:border-violet-500/30 dark:from-violet-950 dark:via-fuchsia-950 dark:to-pink-950">
          <div aria-hidden className="pointer-events-none absolute -right-6 -top-8 size-40 rounded-full bg-violet-300/20 blur-2xl dark:bg-violet-500/10" />
          <div aria-hidden className="pointer-events-none absolute -bottom-10 right-24 size-32 rounded-full bg-pink-300/20 blur-2xl dark:bg-pink-500/10" />
          <div className="relative flex flex-wrap items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-white bg-white/70 shadow-sm dark:border-white/15 dark:bg-white/10">
              <GraduationIcon className="size-8" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-black tracking-tight text-violet-950 dark:text-violet-100">毕业生去向</h1>
              <p className="mt-1 truncate text-xs leading-5 text-violet-900/60 dark:text-violet-200/70">
                校友们的毕业去向一目了然：按人、按校、按届，随时搜索。
              </p>
            </div>
            {statBadge ? (
              <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/80 bg-white/70 px-3 py-2 shadow-sm backdrop-blur dark:border-white/15 dark:bg-white/10">
                <statBadge.icon className="size-4 text-violet-600 dark:text-violet-300" />
                <span className="text-2xl font-black leading-none text-violet-700 dark:text-violet-100">{statBadge.value}</span>
                <span className="text-xs font-medium text-violet-900/60 dark:text-violet-200/70">{statBadge.label}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* 视图切换胶囊：窄屏单行横向滚动，避免换行成三行挤压纵向空间 */}
        <div className="mt-7 flex items-center gap-1.5 overflow-x-auto rounded-full border border-slate-200 bg-white p-1.5 text-sm shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {VIEW_TABS.map((tab) => {
            if (tab.key === "pending" && !canReview) return null;
            const Icon = tab.icon;
            const active = view === tab.key;
            return (
              <button
                key={tab.key}
                className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium transition-all ${
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
                onClick={() => setView(tab.key)}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 视图内容 */}
        <div className="mt-7 flex flex-col gap-5">
          {view === "users" ? <UserListView loading={loading} items={items} /> : null}
          {view === "schools" ? (
            <SchoolListView
              loading={loading}
              schools={schools}
              detail={schoolDetail}
              onSelect={(destination) => void openSchool(destination)}
              onClear={() => setSchoolDetail(null)}
            />
          ) : null}
          {view === "timeline" ? (
            <TimelineView
              loading={loading}
              buckets={buckets}
              items={items}
              by={timelineBy}
              order={timelineOrder}
              year={timelineYear}
              yearType={timelineYearType}
              onByChange={setTimelineBy}
              onOrderChange={setTimelineOrder}
              onYearChange={setTimelineYear}
              onYearTypeChange={setTimelineYearType}
            />
          ) : null}
          {view === "search" ? (
            <SearchView loading={loading} query={searchQuery} onQueryChange={setSearchQuery} items={items} />
          ) : null}
          {view === "pending" && canReview ? (
            <PendingView items={items} onApprove={(target) => void approve(target)} onReject={(target) => setRejectTarget(target)} />
          ) : null}
          {view === "map" ? <MapView /> : null}
        </div>
      </div>

      <GraduationRejectDialog
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onSubmit={async (target, reason) => { await submitReject(target, reason); }}
      />
    </div>
  );
}

function EmptyState({ title, icon: Icon = GraduationIcon }: { title: string; icon?: typeof GraduationIcon }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-16 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl border border-violet-100 bg-violet-50/60">
        <Icon className="size-9 text-violet-300" />
      </span>
      <p className="mt-4 text-sm font-medium text-slate-500">{title}</p>
    </div>
  );
}

/** 地图视图：占位，功能开发中。 */
function MapView() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-16 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl border border-violet-100 bg-violet-50/60">
        <MapIcon className="size-9 text-violet-300" />
      </span>
      <p className="mt-4 text-base font-bold text-slate-900">地图视图</p>
      <p className="mt-1.5 text-sm font-medium text-slate-500">开发中，敬请期待。</p>
    </div>
  );
}

function UserListView({ loading, items }: { loading: boolean; items: GraduationItem[] }) {
  return (
    <>
      {loading ? <p className="py-8 text-center text-sm text-slate-500">正在加载…</p> : null}
      {!loading && items.length === 0 ? <EmptyState title="暂无已通过的毕业去向记录" /> : null}
      {!loading && items.map((item) => <GraduationCard key={item.id} item={item} />)}
    </>
  );
}

function SchoolListView({ loading, schools, detail, onSelect, onClear }: {
  loading: boolean;
  schools: SchoolEntry[];
  detail: { destination: string; items: GraduationItem[] } | null;
  onSelect: (destination: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      {loading ? <p className="py-6 text-center text-sm text-slate-500">正在加载…</p> : null}
      {!loading && schools.length === 0 && !detail ? (
        <EmptyState title="暂无毕业去向数据" />
      ) : null}
      {!loading && schools.length > 0 && !detail ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {schools.map((entry) => (
            <button
              key={entry.destination}
              className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md"
              onClick={() => onSelect(entry.destination)}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-violet-100 bg-violet-50/70 text-violet-600 transition group-hover:bg-violet-100">
                <Building2Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-950">{entry.destination}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {entry.earliestGraduationYear && entry.latestGraduationYear && entry.earliestGraduationYear !== entry.latestGraduationYear
                    ? `${entry.earliestGraduationYear}–${entry.latestGraduationYear} 届`
                    : `${entry.earliestGraduationYear ?? entry.latestGraduationYear ?? "—"} 届`}
                </span>
              </span>
              <span className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold text-violet-700" style={{ background: "linear-gradient(90deg, #f5f3ff 0%, #fdf4ff 100%)" }}>
                {entry.count} 人
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {!loading && detail ? (
        <>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="flex min-w-0 items-center gap-2.5 text-sm font-bold text-slate-950">
              <Building2Icon className="size-4 shrink-0 text-violet-600" />
              <span className="truncate">{detail.destination}</span>
              <span className="shrink-0 text-xs font-medium text-slate-500">（{detail.items.length} 人）</span>
            </p>
            <Button size="sm" variant="outline" onClick={onClear}>返回列表</Button>
          </div>
          <div className="flex flex-col gap-5">
            {detail.items.map((item) => <GraduationCard key={item.id} item={item} />)}
          </div>
        </>
      ) : null}
    </>
  );
}

function TimelineView({ loading, buckets, items, by, order, year, yearType, onByChange, onOrderChange, onYearChange, onYearTypeChange }: {
  loading: boolean;
  buckets: Array<{ year: number; count: number }>;
  items: GraduationItem[];
  by: TimelineBy;
  order: TimelineOrder;
  year: number | "";
  yearType: YearType;
  onByChange: (value: TimelineBy) => void;
  onOrderChange: (value: TimelineOrder) => void;
  onYearChange: (value: number | "") => void;
  onYearTypeChange: (value: YearType) => void;
}) {
  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-slate-600">按</span>
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            {([
              { key: "graduationYear", label: "届" },
              { key: "classYear", label: "级" },
              { key: "createdAt", label: "提交时间" },
            ] as const).map((item) => (
              <button
                key={item.key}
                className={`rounded-md px-2.5 py-1 font-medium ${by === item.key ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
                onClick={() => onByChange(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${order === "asc" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => onOrderChange("asc")}>
              <ArrowUpIcon className="size-3" />升序
            </button>
            <button className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${order === "desc" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => onOrderChange("desc")}>
              <ArrowDownIcon className="size-3" />降序
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">筛选年份</span>
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button className={`rounded-md px-2.5 py-1 font-medium ${yearType === "graduationYear" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => onYearTypeChange("graduationYear")}>届</button>
            <button className={`rounded-md px-2.5 py-1 font-medium ${yearType === "classYear" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`} onClick={() => onYearTypeChange("classYear")}>级</button>
          </div>
          <Input
            type="number"
            placeholder="全部"
            className="w-24"
            value={year === "" ? "" : year}
            onChange={(event) => onYearChange(event.target.value === "" ? "" : Number(event.target.value))}
          />
          {year !== "" ? <Button size="sm" variant="ghost" onClick={() => onYearChange("")}>清除</Button> : null}
        </div>
      </div>

      {buckets.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3.5 text-xs font-semibold text-slate-600">各年人数</p>
          <div className="flex flex-wrap gap-2.5">
            {buckets.map((bucket) => (
              <span key={bucket.year} className="flex items-center gap-1.5 rounded-lg border border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-3.5 py-2 text-xs">
                <span className="font-mono font-bold text-slate-900">{bucket.year}</span>
                <span className="text-violet-300">·</span>
                <span className="font-bold text-violet-600">{bucket.count}</span>
                <span className="text-slate-500">人</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? <p className="py-6 text-center text-sm text-slate-500">正在加载…</p> : null}
      {!loading && items.length === 0 ? <EmptyState title="暂无数据" /> : null}
      {!loading && items.map((item) => <GraduationCard key={item.id} item={item} />)}
    </>
  );
}

function SearchView({ loading, query, onQueryChange, items }: { loading: boolean; query: string; onQueryChange: (value: string) => void; items: GraduationItem[] }) {
  return (
    <>
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="搜索 QQ、用户名或学校"
          className="rounded-xl border-slate-200 bg-white py-3 pl-10 shadow-sm"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      {loading ? <p className="py-6 text-center text-sm text-slate-500">正在搜索…</p> : null}
      {!loading && items.length === 0 && query.trim() ? (
        <EmptyState title={`未找到与「${query.trim()}」匹配的毕业去向`} />
      ) : null}
      {!loading && items.map((item) => <GraduationCard key={item.id} item={item} />)}
    </>
  );
}

function PendingView({ items, onApprove, onReject }: {
  items: GraduationItem[];
  onApprove: (target: GraduationItem) => void;
  onReject: (target: GraduationItem) => void;
}) {
  return (
    <>
      {items.length === 0 ? (
        <EmptyState title="暂无待审核的毕业去向" />
      ) : null}
      {items.map((item) => <GraduationCard key={item.id} item={item} onApprove={onApprove} onReject={onReject} />)}
    </>
  );
}

function GraduationCard({ item, onApprove, onReject }: {
  item: GraduationItem;
  onApprove?: (target: GraduationItem) => void;
  onReject?: (target: GraduationItem) => void;
}) {
  const showActions = Boolean(onApprove || onReject);
  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-200 hover:shadow-md">
      <div className="flex items-start gap-4">
        <Avatar className="size-11 shrink-0 ring-2 ring-violet-100">
          <AvatarImage src={item.author?.qqUin ? qqAvatar(item.author.qqUin) : undefined} alt="" referrerPolicy="no-referrer" loading="lazy" />
          <AvatarFallback className="bg-gradient-to-br from-violet-100 to-fuchsia-100 font-semibold text-violet-700">
            {initials(item.author?.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-950">{item.author?.displayName ?? "未命名用户"}</span>
            <span className="font-mono text-xs text-slate-500">{item.author?.qqUin ?? "—"}</span>
            <span className="text-[11px] text-slate-300">#{item.displayId}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5 text-xs text-slate-600 sm:grid-cols-4">
            <div>
              <span className="text-slate-400">届：</span>
              <span className="font-mono font-semibold text-slate-800">{item.graduationYear}</span>
            </div>
            <div>
              <span className="text-slate-400">级：</span>
              <span className="font-mono font-semibold text-slate-800">{item.classYear}</span>
            </div>
            <div>
              <span className="text-slate-400">学历：</span>
              <span className="rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700">{item.education}</span>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-violet-100 bg-violet-50/50 px-3.5 py-2.5">
            <GraduationCapIcon className="mt-0.5 size-4 shrink-0 text-violet-500" />
            <span className="min-w-0 break-words text-sm font-medium leading-5 text-violet-950">{item.destination}</span>
          </div>
          {item.rejectReason ? <p className="mt-2.5 text-xs text-rose-600">驳回理由：{item.rejectReason}</p> : null}
        </div>
      </div>
      {showActions ? (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          {onApprove ? (
            <Button size="sm" variant="outline" className="border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50" onClick={() => onApprove(item)}>
              允许毕业
            </Button>
          ) : null}
          {onReject ? (
            <Button size="sm" variant="outline" className="border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-50" onClick={() => onReject(item)}>
              驳回
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function GraduationRejectDialog({ target, onClose, onSubmit }: {
  target: GraduationItem | null;
  onClose: () => void;
  onSubmit: (target: GraduationItem, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason("");
  }, [target]);

  if (!target) return null;

  async function submit() {
    if (reason.trim().length === 0) {
      toast.error("必须填写驳回理由");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(target!, reason.trim());
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>驳回毕业去向 #{target.displayId}</DialogTitle>
          <DialogDescription>驳回必须填写理由，提交者会收到驳回通知。</DialogDescription>
        </DialogHeader>
        <div className="px-5">
          <Textarea
            placeholder="填写驳回理由..."
            value={reason}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {busy ? "提交中..." : "确认驳回"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
