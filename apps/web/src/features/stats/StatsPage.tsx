import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIcon,
  BarChart3Icon,
  BotIcon,
  CalendarRangeIcon,
  ClockIcon,
  ImageIcon,
  MegaphoneIcon,
  ShieldAlertIcon,
  SparklesIcon,
  UsersRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { roleLabels, statusLabels } from "@/lib/app-model";
import { readListPreferences, writeListPreferences } from "@/lib/list-preferences";
import { hasAnyQueryParam, readQueryInt, writeQueryParams } from "@/lib/url-query";
import type { TenantRole, TenantStats } from "@/types/app";
import { EmptyCard, LoadingBlock } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const publishStatusLabels: Record<string, string> = {
  queued: "排队中",
  running: "发布中",
  waiting_cookies: "等待登录态",
  succeeded: "成功",
  failed: "失败",
  skipped: "跳过",
};

const auditActionLabels: Record<string, string> = {
  "bot.qzone.cookies.refresh": "刷新登录态",
  "bot.qzone.cookies.auto_refresh": "自动刷新登录态",
  "bot.qzone.cookies.auto_refresh_failed": "自动刷新失败",
  "bot.qzone.cookies.qr_login": "扫码登录",
  "bot_account.create": "创建机器人",
  "bot_account.update": "更新机器人",
  "publish_target.create": "创建发布目标",
  "publish_target.update": "更新发布目标",
  "publish_attempt.retry": "重试发布",
  "member.update_role": "修改成员身份",
  "ban.create": "封禁用户",
};

const timeRanges = [7, 14, 30, 90] as const;
type StatsListPreferences = {
  rangeDays: (typeof timeRanges)[number];
};

function statsPreferencesKey(tenantId: string) {
  return `tenant.${tenantId}.stats`;
}

function isStatsListPreferences(value: unknown): value is StatsListPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StatsListPreferences>;
  return timeRanges.some((days) => days === candidate.rangeDays);
}

function readStatsListPreferences(tenantId: string): StatsListPreferences {
  if (hasAnyQueryParam(["days"])) {
    return {
      rangeDays: readQueryInt("days", 14, { allowed: timeRanges }) as (typeof timeRanges)[number],
    };
  }
  return readListPreferences(statsPreferencesKey(tenantId), { rangeDays: 14 }, isStatsListPreferences);
}

export function StatsPage({ tenantId, loading, currentRole, onOpenUserDetail }: { tenantId: string; loading: boolean; currentRole: TenantRole; onOpenUserDetail: (userId: string) => void }) {
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [rangeDays, setRangeDays] = useState<(typeof timeRanges)[number]>(() => readStatsListPreferences(tenantId).rangeDays);

  async function refreshStats(days = rangeDays) {
    setStatsLoading(true);
    try {
      const data = await api<TenantStats>(`/api/stats/tenant?days=${days}`);
      setStats(data);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "无法读取统计数据");
    } finally {
      setStatsLoading(false);
    }
  }

  useEffect(() => {
    setStats(null);
    void refreshStats(rangeDays);
  }, [rangeDays, tenantId]);

  useEffect(() => {
    setRangeDays(readStatsListPreferences(tenantId).rangeDays);
  }, [tenantId]);

  const maxHourly = useMemo(() => Math.max(1, ...(stats?.posts.hourly.map((hour) => hour.total) ?? [1])), [stats]);
  const currentRangeLabel = stats ? `近 ${stats.range.days} 天` : `近 ${rangeDays} 天`;
  const qzoneVisitorCharts = useMemo(() => {
    if (!stats) return [];
    return stats.qzoneVisitors.targets.length > 0
      ? stats.qzoneVisitors.targets
      : [
          {
            id: "tenant-aggregate",
            displayName: "QZone 访客",
            bot: null,
            daily: stats.qzoneVisitors.daily,
          },
        ];
  }, [stats]);
  const botFriendCharts = useMemo(() => {
    if (!stats) return [];
    return stats.botFriends.bots.length > 0
      ? stats.botFriends.bots.map((chart) => ({
          id: chart.botAccountId,
          displayName: chart.bot.displayName,
          bot: chart.bot,
          daily: chart.daily,
        }))
      : [
          {
            id: "tenant-aggregate-friends",
            displayName: "好友总量",
            bot: null,
            daily: stats.botFriends.daily,
          },
        ];
  }, [stats]);

  return (
    <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto px-4 py-4 pb-24 md:pb-6">
      {loading || statsLoading ? <LoadingBlock title="正在整理统计数据..." /> : null}
      {!stats && !statsLoading ? <EmptyCard title="暂时没有统计数据" /> : null}
      {stats ? (
        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
              <BarChart3Icon className="size-4" />
              最近更新：{formatDateTime(stats.generatedAt)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
                <CalendarRangeIcon className="ml-2 size-4 text-slate-400" />
                {timeRanges.map((days) => (
                  <button
                    key={days}
                    className={`h-7 rounded-full px-3 text-xs font-bold transition ${rangeDays === days ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}
                    type="button"
                    onClick={() => {
                      setRangeDays(days);
                      writeListPreferences(statsPreferencesKey(tenantId), { rangeDays: days });
                      writeQueryParams({ days: days === 14 ? null : days });
                    }}
                  >
                    {days} 天
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" disabled={statsLoading} onClick={() => void refreshStats()}>
                刷新
              </Button>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <MetricCard icon={MegaphoneIcon} label="总稿件" value={stats.overview.totalPosts} sub={`近 7 天 ${stats.overview.recent7Posts} 条`} />
            <MetricCard icon={UsersRoundIcon} label="投稿用户" value={stats.overview.uniqueAuthors} sub={`近 30 天活跃 ${stats.overview.activeAuthors30d} 人`} />
            <MetricCard icon={ClockIcon} label="平均审核" value={stats.overview.avgReviewMinutes === null ? "暂无" : `${stats.overview.avgReviewMinutes} 分钟`} sub="近 30 天通过/拒绝" />
            <MetricCard icon={SparklesIcon} label="发布成功率" value={stats.publishing.successRate === null ? "暂无" : `${stats.publishing.successRate}%`} sub={`${stats.publishing.byStatus.succeeded ?? 0} 成功 / ${stats.publishing.byStatus.failed ?? 0} 失败`} />
          </div>

          <section className="product-surface min-w-0 p-4">
            <SectionTitle icon={ActivityIcon} title="稿件概览" />
            <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <StatusGrid values={stats.posts.byStatus} labels={statusLabels} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <SmallFact label="匿名比例" value={formatPercent(stats.overview.anonymousRate)} detail={`${stats.overview.anonymousPosts} 条匿名稿件`} />
                <SmallFact label="配图比例" value={formatPercent(stats.overview.imageRate)} detail={`${stats.overview.imagesTotal} 张图，均值 ${formatNullable(stats.overview.avgImagesPerPost)}`} />
                <SmallFact label="投稿来源" value={`对话 ${stats.posts.bySource.private} / 网页 ${stats.posts.bySource.web}`} detail={`共 ${stats.overview.totalPosts} 条稿件`} />
                <SmallFact label="封禁状态" value={`${stats.members.activeBans} 生效中`} detail={`历史封禁 ${stats.members.totalBans} 条`} />
              </div>
            </div>
          </section>

          <section className="product-surface min-w-0 p-4">
            <SectionTitle icon={BarChart3Icon} title="稿件、用户与访客走势" />
            <div className="mt-3 grid min-w-0 gap-3">
              <LineChartPanel
                title={`${currentRangeLabel}稿件数量`}
                description={`${currentRangeLabel}每日新增稿件、已通过稿件与通过率`}
                height={240}
                series={[
                  { label: "新增稿件", color: "#2563eb", values: stats.posts.daily.map((day) => ({ label: formatDay(day.date), value: day.total })) },
                  { label: "已通过", color: "#16a34a", values: stats.posts.daily.map((day) => ({ label: formatDay(day.date), value: day.approved + day.published })) },
                ]}
                footer={<ApprovalRateStrip daily={stats.posts.daily} />}
              />
              <LineChartPanel
                title={`${currentRangeLabel}用户数量`}
                description={`${currentRangeLabel}累计成员与每日新增用户`}
                height={240}
                series={[
                  { label: "累计用户", color: "#7c3aed", values: stats.posts.userDaily.map((day) => ({ label: formatDay(day.date), value: day.totalMembers })) },
                  { label: "新增用户", color: "#f59e0b", values: stats.posts.userDaily.map((day) => ({ label: formatDay(day.date), value: day.newMembers })) },
                ]}
              />
              {qzoneVisitorCharts.map((chart) => (
                <LineChartPanel
                  key={chart.id}
                  title={`${currentRangeLabel}${chart.displayName}`}
                  description={
                    chart.bot
                      ? `${currentRangeLabel}每日访客与累计总访客（${chart.bot.displayName} / QQ ${chart.bot.qqUin}）`
                      : `${currentRangeLabel}每日访客与累计总访客（来自 cookies 检测接口）`
                  }
                  height={240}
                  series={[
                    { label: "每日访客", color: "#0ea5e9", values: chart.daily.map((day) => ({ label: formatDay(day.date), value: day.todayCount })) },
                    { label: "累计访客", color: "#ef4444", values: chart.daily.map((day) => ({ label: formatDay(day.date), value: day.totalCount })) },
                  ]}
                />
              ))}
              {botFriendCharts.map((chart) => (
                <LineChartPanel
                  key={chart.id}
                  title={`${currentRangeLabel}${chart.displayName}好友量`}
                  description={
                    chart.bot
                      ? `${currentRangeLabel}每日好友总量（${chart.bot.displayName} / QQ ${chart.bot.qqUin}），每天自动采集`
                      : `${currentRangeLabel}每日好友总量，每天自动采集`
                  }
                  height={240}
                  series={[
                    { label: "好友量", color: "#0d9488", values: chart.daily.map((day) => ({ label: formatDay(day.date), value: day.friendCount })) },
                  ]}
                />
              ))}
            </div>
          </section>

          <div className="grid min-w-0 gap-3">
            <section className="product-surface min-w-0 p-4">
              <SectionTitle icon={ClockIcon} title="时段分布" />
              <div className="mt-3 grid grid-cols-12 gap-1">
                {stats.posts.hourly.map((hour) => (
                  <div key={hour.hour} className="flex min-h-28 flex-col justify-end gap-1">
                    <div className="rounded-t bg-blue-200" style={{ height: `${Math.max(4, (hour.total / maxHourly) * 88)}px` }} title={`${hour.hour}:00 ${hour.total} 条`} />
                    <span className="text-center text-[10px] font-bold text-slate-400">{hour.hour}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="product-surface min-w-0 p-4">
              <SectionTitle icon={UsersRoundIcon} title="用户与审核" />
              <div className="mt-3 grid gap-2">
                <SmallFact label="成员总数" value={stats.members.total} detail={`用户 ${stats.members.byRole.submitter ?? 0} / 审核员 ${stats.members.byRole.reviewer ?? 0} / 管理员 ${stats.members.byRole.admin ?? 0}`} />
                <SmallFact label={`${currentRangeLabel}审核`} value={stats.review.reviewed30d} detail={`通过 ${stats.review.approved30d} / 拒绝 ${stats.review.rejected30d}`} />
                <SmallFact label="高频投稿账号" value={stats.posts.topAuthors30d.length} detail={stats.posts.topAuthors30d.length ? `按${currentRangeLabel}投稿量排序` : "暂无活跃投稿"} />
                {stats.posts.topAuthors30d.map((author) => (
                  <TopAuthorRow
                    key={author.authorId}
                    author={author}
                    max={Math.max(1, stats.posts.topAuthors30d[0]?.count ?? 1)}
                    canOpenDetail={currentRole === "admin"}
                    onOpenDetail={onOpenUserDetail}
                  />
                ))}
              </div>
            </section>
          </div>

          <details className="product-surface min-w-0 overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
              <SectionTitle icon={BotIcon} title="机器人与发布目标" />
              <span className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">展开</span>
            </summary>
            <div className="grid gap-2 border-t border-slate-100 px-4 pb-4 pt-3">
              {stats.bots.map((bot) => (
                <div key={bot.id} className="product-row-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-950">{bot.displayName}</p>
                      <p className="text-xs font-bold text-slate-500">QQ {bot.qqUin}</p>
                    </div>
                    <Badge variant={bot.enabled ? "secondary" : "outline"}>{bot.enabled ? "启用" : "停用"}</Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs font-semibold text-slate-500">
                    <span>发布目标：{bot.publishTargetCount}</span>
                    <span>审核群：{bot.reviewGroupId ?? "未配置"}</span>
                    <span>最近连接：{bot.lastSeenAt ? formatDateTime(bot.lastSeenAt) : "未连接"}</span>
                    <span>空间登录态：{bot.qzoneSession ? `${sessionStatusLabel(bot.qzoneSession.status)}，${bot.qzoneSession.checkedAt ? formatDateTime(bot.qzoneSession.checkedAt) : "未检测"}` : "未登录"}</span>
                  </div>
                </div>
              ))}
              {stats.bots.length === 0 ? <EmptyCard title="还没有机器人" /> : null}
            </div>
          </details>

          <details className="product-surface min-w-0 overflow-hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
              <SectionTitle icon={SparklesIcon} title="发布质量" />
              <span className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">展开</span>
            </summary>
            <div className="grid min-w-0 gap-3 border-t border-slate-100 px-4 pb-4 pt-3">
              <StatusGrid values={stats.publishing.byStatus} labels={publishStatusLabels} />
              <div className="grid gap-2">
                {stats.publishing.targets.map((target) => (
                  <div key={target.id} className="product-row-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-950">{target.displayName}</p>
                        <p className="text-xs font-bold text-slate-500">{target.bot.displayName} / QQ {target.bot.qqUin}</p>
                      </div>
                      <Badge variant={target.enabled ? "secondary" : "outline"}>{target.enabled ? "启用" : "停用"}</Badge>
                    </div>
                    <div className="mt-2 text-xs font-semibold text-slate-500">
                      成功率 {formatPercent(target.successRate)} · 风控间隔 {target.delaySeconds}s · 成功 {target.counts.succeeded ?? 0} / 失败 {target.counts.failed ?? 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>

          <div className="grid min-w-0 gap-3">
            <details className="product-surface min-w-0 overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <SectionTitle icon={ShieldAlertIcon} title="最近发布失败" />
                <span className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">展开</span>
              </summary>
              <div className="grid gap-2 border-t border-slate-100 px-4 pb-4 pt-3">
                {stats.publishing.recentFailures.map((failure) => (
                  <div key={failure.id} className="product-row-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="outline">稿件 #{failure.postDisplayId}</Badge>
                      <span className="text-xs font-bold text-slate-400">{formatDateTime(failure.updatedAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-800">{failure.postText}</p>
                    <p className="mt-1 text-xs font-bold text-red-700">{failure.lastError ?? "未知错误"}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{failure.targetName} · {failure.botName} / QQ {failure.botQqUin}</p>
                  </div>
                ))}
                {stats.publishing.recentFailures.length === 0 ? <EmptyCard title="最近没有发布失败" /> : null}
              </div>
            </details>

            <details className="product-surface min-w-0 overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <SectionTitle icon={ImageIcon} title="管理操作" />
                <span className="shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">展开</span>
              </summary>
              <div className="grid gap-2 border-t border-slate-100 px-4 pb-4 pt-3">
                {stats.audit.actions30d.map((action) => (
                  <BarRow key={action.action} label={auditActionLabels[action.action] ?? action.action} value={action.count} max={Math.max(1, stats.audit.actions30d[0]?.count ?? 1)} detail="次" />
                ))}
                {stats.audit.actions30d.length === 0 ? <EmptyCard title="近 30 天没有管理操作" /> : null}
              </div>
            </details>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TopAuthorRow({
  author,
  max,
  canOpenDetail,
  onOpenDetail,
}: {
  author: TenantStats["posts"]["topAuthors30d"][number];
  max: number;
  canOpenDetail: boolean;
  onOpenDetail: (userId: string) => void;
}) {
  const name = author.user?.displayName || (author.user ? `QQ ${author.user.qqUin}` : shortId(author.authorId));
  const meta = author.user ? `QQ ${author.user.qqUin}` : `用户 ID ${shortId(author.authorId)}`;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800">{name}</p>
          <p className="truncate text-xs font-semibold text-slate-500">{meta}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-black text-slate-700">{author.count} 条</span>
          {canOpenDetail ? (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onOpenDetail(author.authorId)}>
              查看
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.max(4, (author.count / max) * 100)}%` }} />
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof ActivityIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
      <span className="grid size-8 place-items-center rounded-md product-accent-blue">
        <Icon className="size-4" />
      </span>
      {title}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub }: { icon: typeof ActivityIcon; label: string; value: number | string; sub: string }) {
  return (
    <div className="product-surface min-w-0 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-500">{label}</p>
        <Icon className="size-4 text-slate-400" />
      </div>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>
    </div>
  );
}

function SmallFact({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white p-3 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p>
    </div>
  );
}

type ChartPoint = {
  label: string;
  value: number;
};

type ChartSeries = {
  label: string;
  color: string;
  values: ChartPoint[];
};

function LineChartPanel({ title, description, series, height, footer }: { title: string; description: string; series: ChartSeries[]; height: number; footer?: ReactNode }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const allValues = series.flatMap((item) => item.values.map((point) => point.value));
  const maxValue = Math.max(1, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const chartWidth = 640;
  const chartHeight = height;
  const padding = { top: 18, right: 18, bottom: 36, left: 42 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;
  const labels = series[0]?.values.map((point) => point.label) ?? [];
  const activeLabel = activeIndex === null ? null : labels[activeIndex];

  function xAt(index: number, total: number) {
    return padding.left + (total <= 1 ? innerWidth / 2 : (index / (total - 1)) * innerWidth);
  }

  function yAt(value: number) {
    const range = Math.max(1, maxValue - minValue);
    return padding.top + innerHeight - ((value - minValue) / range) * innerHeight;
  }

  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white p-3 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {series.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
              <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 max-w-full overflow-x-auto">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[560px] w-full touch-pan-x" style={{ height }}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + ratio * innerHeight;
            const value = Math.round(maxValue - ratio * (maxValue - minValue));
            return (
              <g key={ratio}>
                <line x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
                <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-bold">
                  {value}
                </text>
              </g>
            );
          })}
          {labels.map((label, index) => {
            if (index % Math.max(1, Math.ceil(labels.length / 7)) !== 0 && index !== labels.length - 1) return null;
            const x = xAt(index, labels.length);
            return (
              <text key={`${label}-${index}`} x={x} y={chartHeight - 12} textAnchor="middle" className="fill-slate-400 text-[10px] font-bold">
                {label}
              </text>
            );
          })}
          {series.map((item) => {
            const points = item.values.map((point, index) => `${xAt(index, item.values.length)},${yAt(point.value)}`).join(" ");
            const areaPoints = `${padding.left},${padding.top + innerHeight} ${points} ${chartWidth - padding.right},${padding.top + innerHeight}`;
            return (
              <g key={item.label}>
                <polyline points={areaPoints} fill={item.color} opacity="0.07" stroke="none" />
                <polyline points={points} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {item.values.map((point, index) => (
                  <g key={`${item.label}-${point.label}-${index}`}>
                    <circle cx={xAt(index, item.values.length)} cy={yAt(point.value)} r={activeIndex === index ? "5" : "3.5"} fill="var(--chart-point-fill)" stroke={item.color} strokeWidth={activeIndex === index ? "2.5" : "2"} />
                    <title>{`${point.label} ${item.label}: ${point.value}`}</title>
                  </g>
                ))}
              </g>
            );
          })}
          {activeIndex !== null ? <line x1={xAt(activeIndex, labels.length)} x2={xAt(activeIndex, labels.length)} y1={padding.top} y2={chartHeight - padding.bottom} stroke="var(--chart-active-line)" strokeDasharray="4 4" strokeWidth="1.5" /> : null}
          {labels.map((label, index) => {
            const left = index === 0 ? padding.left : (xAt(index - 1, labels.length) + xAt(index, labels.length)) / 2;
            const right = index === labels.length - 1 ? chartWidth - padding.right : (xAt(index, labels.length) + xAt(index + 1, labels.length)) / 2;
            return (
              <rect
                key={`hit-${label}-${index}`}
                aria-label={`查看 ${label} 的统计`}
                className="cursor-pointer focus:outline-none"
                fill="transparent"
                height={innerHeight}
                role="button"
                tabIndex={0}
                width={Math.max(1, right - left)}
                x={left}
                y={padding.top}
                onBlur={() => setActiveIndex(null)}
                onClick={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onMouseEnter={() => setActiveIndex(index)}
              />
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
        {activeIndex === null || !activeLabel ? (
          <span>悬停或点击曲线查看单日数据</span>
        ) : (
          <>
            <span className="font-bold text-slate-900">{activeLabel}</span>
            {series.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 ring-1 ring-slate-200">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label} {item.values[activeIndex]?.value ?? 0}
              </span>
            ))}
          </>
        )}
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

function ApprovalRateStrip({ daily }: { daily: TenantStats["posts"]["daily"] }) {
  const rates = daily.map((day) => ({
    date: formatShortDay(day.date),
    total: day.total,
    rate: day.total > 0 ? Math.round(((day.approved + day.published) / day.total) * 1000) / 10 : null,
  }));
  return (
    <div className="rounded-md border border-green-100 bg-green-50/60 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-green-900">每日通过率</p>
        <p className="text-xs font-semibold text-green-700">通过 + 已发布 / 当日新增</p>
      </div>
      <div className="grid grid-cols-5 gap-1 sm:grid-cols-8 lg:grid-cols-5 xl:grid-cols-8">
        {rates.map((item) => (
          <div key={item.date} className="rounded bg-white/80 px-2 py-1 text-center ring-1 ring-green-100">
            <p className="text-[10px] font-bold text-slate-400">{item.date}</p>
            <p className="text-xs font-black text-green-800">{item.rate === null ? "-" : `${item.rate}%`}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusGrid({ values, labels }: { values: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(values).filter(([, value]) => value > 0);
  if (entries.length === 0) {
    return <EmptyCard title="暂无状态数据" />;
  }
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
          <p className="text-xs font-bold text-slate-500">{labels[key] ?? key}</p>
          <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
        </div>
      ))}
    </div>
  );
}

function BarRow({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2 text-xs font-bold">
        <span className="min-w-0 truncate text-slate-600">{label}</span>
        <span className="shrink-0 text-slate-400">
          {value} {detail}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-300" style={{ width: `${Math.max(3, (value / max) * 100)}%` }} />
      </div>
    </div>
  );
}

function formatPercent(value: number | null) {
  return value === null ? "暂无" : `${value}%`;
}

function formatNullable(value: number | null) {
  return value === null ? "暂无" : String(value);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: string) {
  return value.replaceAll("-", "/");
}

function formatShortDay(value: string) {
  return value.slice(5).replace("-", "/");
}

function sessionStatusLabel(status: string) {
  if (status === "available") return "可用";
  if (status === "invalid") return "失效";
  if (status === "expired") return "过期";
  return "未检测";
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}
