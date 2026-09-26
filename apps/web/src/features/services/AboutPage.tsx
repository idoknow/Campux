import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BookOpenIcon, ChevronLeftIcon, ChevronRightIcon, CloudIcon, CopyIcon, ExternalLinkIcon, FileTextIcon, InfoIcon, ServerIcon, ShieldCheckIcon, TagIcon, UserRoundIcon, UsersIcon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { TenantMetadata } from "@/types/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PLUGIN_SHOWCASE } from "@/features/admin/PluginConfigPage";

type AboutInfo = {
  product: string;
  version: string;
  deployment: "cloud" | "self-hosted";
  latestVersion: string | null;
};

type ShowcasePlugin = (typeof PLUGIN_SHOWCASE)[number];

const repositoryUrl = "https://github.com/idoknow/Campux";
const licenseUrl = `${repositoryUrl}/blob/main/LICENSE`;

const officialLinks = [
  { label: "官方网站", host: "campux.top", url: "https://campux.top" },
  { label: "在线文档", host: "docs.campux.top", url: "https://docs.campux.top" },
  { label: "Cloud 控制台", host: "app.campux.top", url: "https://app.campux.top" },
  { label: "GitHub 仓库", host: "github.com/idoknow", url: repositoryUrl },
];

const qqGroups = [
  { label: "Campux 技术交流", number: "226427026", url: "https://qm.qq.com/q/5d8IOOljXW" },
  { label: "Campux App 用户组", number: "1124751247", url: "https://qm.qq.com/q/MrGZr0HOUw" },
];

// 仓库贡献者，按 GitHub 贡献者列表顺序（提交数降序），已排除 dependabot[bot] 与 Copilot 两个机器人账号。
// name 为 GitHub 用户接口核验过的显示名；RockChinQ 的显示名只有一个 emoji，作为标题不可读，回落登录名。
const developers = [
  { login: "RockChinQ", name: "RockChinQ" },
  { login: "MrWoods1692", name: "Mr.C.Woods" },
  { login: "fhzit", name: "HelloFHZ" },
  { login: "Soulter", name: "Soulter" },
  { login: "dadachann", name: "Hyu" },
  { login: "2671016745", name: "应急食品" },
  { login: "rocksclawbot", name: "Nody the lobster" },
  { login: "haohaoxuedili", name: "haohaoxuedili" },
  { login: "cuteyuchen", name: "yuchen" },
  { login: "cute-rui", name: "Lightwing" },
  { login: "superman32432432", name: "superman32432432" },
];

// 插件的 author 是署名，不一定等于 GitHub 登录名：HelloFHZ 的登录名是 fhzit。
// 找不到对应的第三方插件作者就不展示头像与链接，只留署名。
const authorGithubLogins: Record<string, string> = {
  MrWoods1692: "MrWoods1692",
  HelloFHZ: "fhzit",
  haohaoxuedili: "haohaoxuedili",
};

const techStack = [
  { name: "TypeScript", detail: "全栈类型安全" },
  { name: "Bun", detail: "运行时与包管理" },
  { name: "Fastify", detail: "后端 HTTP 服务" },
  { name: "Prisma", detail: "数据访问与迁移" },
  { name: "SQLite / PostgreSQL", detail: "单文件部署或数据库部署" },
  { name: "React 19", detail: "前端界面" },
  { name: "Vite", detail: "前端构建与开发服务器" },
  { name: "Tailwind CSS", detail: "样式系统" },
  { name: "Radix UI", detail: "无障碍组件基座" },
  { name: "OneBot v11", detail: "QQ 机器人接入协议" },
  { name: "S3 / MinIO", detail: "对象存储" },
  { name: "Docker", detail: "自托管部署" },
];

// 插件启用状态与租户元数据同源：服务端 metadata 路由已把 plugin_config.*.enabled
// 归一化成这些布尔字段，服务页读的也是同一份数据，不额外请求管理端接口。
const pluginEnabledFlags: Record<ShowcasePlugin["id"], (metadata: TenantMetadata) => boolean> = {
  markdownRender: (metadata) => metadata.enableMarkdownRender,
  colorSelection: (metadata) => metadata.enableColorSelection,
  fontSelection: (metadata) => metadata.enableFontSelection,
  anonymousAvatar: (metadata) => metadata.enableAnonymousAvatarSelection,
  botStylishMessages: (metadata) => metadata.botStylishMessagesEnabled,
  campaigns: (metadata) => metadata.enableCampaigns,
  aggregateLogin: (metadata) => metadata.enableAggregateLogin,
  broadcast: (metadata) => metadata.enableBroadcast,
  feedback: (metadata) => metadata.enableFeedback,
  botAlert: (metadata) => metadata.enableBotAlert,
  graduation: (metadata) => metadata.enableGraduation,
  todayInHistory: (metadata) => metadata.enableTodayInHistory,
};

// 卡片与文字统一走主题令牌：about 页不再写死 bg-white / text-slate-*，否则深色模式下会发白。
const enabledBadgeClass = "inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 ring-1 ring-emerald-500/25";
const disabledBadgeClass = "inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border";

// 板块图标底色复用 styles.css 里已有的 product-accent-* ，它们在 .dark 下有对应色值。
type SectionAccent = "blue" | "green" | "amber" | "rose" | "violet";
const accentTileClass: Record<SectionAccent, string> = {
  blue: "product-accent-blue",
  green: "product-accent-green",
  amber: "product-accent-amber",
  rose: "product-accent-rose",
  violet: "product-accent-violet",
};

/** 版本号形如 v2.2.0 / v2.2.0-abc1234，只对比前三段数字。 */
function readSemver(value: string) {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] as const : null;
}

function describeUpdateState(current: string, latest: string): "outdated" | "latest" | "unknown" {
  const currentParts = readSemver(current);
  const latestParts = readSemver(latest);
  if (!currentParts || !latestParts) {
    return "unknown";
  }
  for (let index = 0; index < currentParts.length; index += 1) {
    if (currentParts[index] !== latestParts[index]) {
      // 本地版本比官方更新（开发分支）时不断言升级状态，避免误报。
      return (currentParts[index] ?? 0) < (latestParts[index] ?? 0) ? "outdated" : "unknown";
    }
  }
  return "latest";
}

function githubAvatarUrl(login: string) {
  return `https://github.com/${login}.png?size=160`;
}

function githubProfileUrl(login: string) {
  return `https://github.com/${login}`;
}

export function AboutPage({ metadata, onBack }: { metadata: TenantMetadata; onBack: () => void }) {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePlugin, setActivePlugin] = useState<ShowcasePlugin | null>(null);

  useEffect(() => {
    let ignore = false;
    void api<AboutInfo>("/api/about")
      .then((data) => {
        if (!ignore) setInfo(data);
      })
      .catch(() => {
        // 版本信息取不到不该挡住整页：协议、开发者、技术栈与插件清单都在前端本地。
        if (!ignore) setInfo(null);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const pendingText = loading ? "读取中…" : "暂不可用";
  const currentVersion = info?.version?.trim() || pendingText;
  const latestVersion = info ? (info.latestVersion ?? "暂时无法获取") : pendingText;
  const isOfficialCloud = info?.deployment === "cloud";
  const deploymentLabel = info ? (isOfficialCloud ? "官方 Cloud" : "私有部署") : pendingText;
  const deploymentCaption = info
    ? isOfficialCloud
      ? "当前实例由 Campux 官方统一运营。"
      : "当前实例由部署者自行维护，是否升级由实例维护者决定。"
    : "暂时无法读取实例信息，版本与部署形态可能不准确。";

  function copyGroupNumber(number: string, label: string) {
    void navigator.clipboard.writeText(number).then(
      () => toast.success(`${label} 群号已复制：${number}`),
      () => toast.error("复制失败，请手动记录群号。"),
    );
  }

  const updateState = describeUpdateState(currentVersion, latestVersion);

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pt-4">
      <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="返回服务" onClick={onBack}>
            <ChevronLeftIcon />
          </Button>
          <h1 className="text-base font-bold text-foreground">关于</h1>
        </div>

        <section className="product-surface overflow-hidden">
          <div className="relative flex flex-col items-center px-4 pb-5 pt-7 text-center">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-sky-50 to-transparent" />
            <span className="relative grid size-20 place-items-center rounded-2xl border border-border bg-white shadow-sm">
              <img src="/logo.svg" alt="Campux logo" className="size-14 object-contain" />
            </span>
            <p className="relative mt-3 text-2xl font-black tracking-tight text-foreground">Campux</p>
            <p className="relative mt-1 text-xs text-muted-foreground">开源校园墙运营系统</p>
            <span className={isOfficialCloud ? "relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-600 ring-1 ring-sky-500/25" : "relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border"}>
              {isOfficialCloud ? <CloudIcon className="size-3.5" /> : <ServerIcon className="size-3.5" />}
              {deploymentLabel}
            </span>
            <p className="relative mt-2 max-w-[420px] text-xs leading-5 text-muted-foreground">{deploymentCaption}</p>
          </div>

          <div className="grid gap-2 border-t border-border bg-muted/40 px-4 py-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-left">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <TagIcon className="size-3.5" />
                当前版本
              </p>
              <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">{currentVersion}</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-left">
              <p className="flex items-center justify-between gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <TagIcon className="size-3.5" />
                  官方最新版本
                </span>
                {updateState === "outdated" ? <span className="font-semibold text-amber-600">可升级</span> : null}
                {updateState === "latest" ? <span className="font-semibold text-emerald-600">已是最新</span> : null}
              </p>
              <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">{latestVersion}</p>
            </div>
          </div>
        </section>

        <AboutSection title="开源协议" icon={FileTextIcon} accent="amber" description="Apache License 2.0">
          <p className="text-sm leading-6 text-muted-foreground">
            Campux 以 Apache License 2.0 协议开源：可自由使用、修改与再分发，需保留版权声明与许可声明，并说明修改内容。
          </p>
          <a className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" href={licenseUrl} target="_blank" rel="noreferrer">
            查看完整协议文本
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </AboutSection>

        <AboutSection title="版权信息" icon={ShieldCheckIcon} accent="rose" description="Copyright © Campux 及其贡献者">
          <p className="text-sm leading-6 text-muted-foreground">
            Copyright © Campux 及其贡献者，依据 Apache License 2.0 授权发布。
          </p>
          <p className="text-xs leading-5 text-muted-foreground/80">
            代码版权归各自贡献者所有，第三方依赖与素材的版权归其原作者所有；Apache License 2.0 不授予商标使用权。
          </p>
        </AboutSection>

        <AboutSection title="Campux 简介" icon={BookOpenIcon} accent="blue">
          <p className="text-sm leading-6 text-muted-foreground">
            Campux 是面向校园墙运营管理员的开源运营系统：网页与 QQ 私聊双重投稿渠道、审核队列、QQ 机器人接入、QZone 自动发布、
            评论同步、统计看板与多租户管理一体化，一套 TypeScript 应用即可自托管运行。
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            它既能作为单个校园墙的自用工具（隐藏多租户机制），也能作为多墙运营平台，让运营者自助开墙：注册账号、创建校园墙、
            接入墙号机器人后即可跑通投稿到发布的全流程。
          </p>
        </AboutSection>

        <AboutSection title="官方网站" icon={ExternalLinkIcon} accent="green" description="官方站点与代码仓库">
          <div className="grid gap-2 sm:grid-cols-2">
            {officialLinks.map((link) => (
              <a key={link.url} className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition hover:border-primary/40 hover:bg-muted/50" href={link.url} target="_blank" rel="noreferrer">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{link.label}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{link.host}</span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
              </a>
            ))}
          </div>
        </AboutSection>

        <AboutSection title="QQ 交流群" icon={UserRoundIcon} accent="violet" description="点击卡片打开 QQ 加群链接，右侧图标复制群号。">
          <div className="grid gap-2 sm:grid-cols-2">
            {qqGroups.map((group) => (
              <div key={group.number} className="flex items-center gap-2 rounded-lg border border-border bg-card p-1.5 pl-3 transition hover:border-primary/40 hover:bg-muted/50">
                <a className="group flex min-w-0 flex-1 items-center gap-3" href={group.url} target="_blank" rel="noreferrer">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-white text-[11px] font-black tracking-tight text-sky-600 shadow-sm">QQ</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{group.label}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{group.number}</span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
                </a>
                <Button variant="ghost" size="icon-sm" aria-label={`复制${group.label}群号`} onClick={() => copyGroupNumber(group.number, group.label)}>
                  <CopyIcon />
                </Button>
              </div>
            ))}
          </div>
        </AboutSection>

        <AboutSection title="开发者" icon={UsersIcon} accent="violet" description={`Campux 仓库共 ${developers.length} 位贡献者，点击可打开对应的 GitHub 主页。`}>
          <div className="grid gap-2 sm:grid-cols-2">
            {developers.map((developer) => (
              <a key={developer.login} className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition hover:border-primary/40 hover:bg-muted/50" href={githubProfileUrl(developer.login)} target="_blank" rel="noreferrer">
                <Avatar size="lg">
                  <AvatarImage src={githubAvatarUrl(developer.login)} alt={`${developer.name} 的 GitHub 头像`} />
                  <AvatarFallback>{developer.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{developer.name}</span>
                  {developer.name === developer.login ? null : (
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">@{developer.login}</span>
                  )}
                </span>
                <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
              </a>
            ))}
          </div>
          <a className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" href={`${repositoryUrl}/graphs/contributors`} target="_blank" rel="noreferrer">
            查看全部贡献者
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </AboutSection>

        <AboutSection title="技术栈" icon={WrenchIcon} accent="green" description="当前版本用到的开源组件">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {techStack.map((item) => (
              <span key={item.name} className="rounded-lg border border-border bg-card px-2.5 py-2">
                <span className="block text-xs font-semibold leading-4 text-foreground">{item.name}</span>
                <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{item.detail}</span>
              </span>
            ))}
          </div>
        </AboutSection>

        <AboutSection title="插件与开发者" icon={InfoIcon} accent="amber" description={`共 ${PLUGIN_SHOWCASE.length} 个预设插件，启用状态对应当前校园墙，点击可查看插件介绍。`}>
          <div className="grid gap-2">
            {PLUGIN_SHOWCASE.map((plugin) => {
              const Icon = plugin.icon;
              const enabled = pluginEnabledFlags[plugin.id](metadata);
              const authorLogin = authorGithubLogins[plugin.author];
              return (
                <button key={plugin.id} type="button" className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-muted/50" onClick={() => setActivePlugin(plugin)}>
                  {/* 插件图标自带品牌色，底色统一用白色牌子衬托。
                      这里用字面色值而不是 bg-white：styles.css 的 .dark .bg-white 会把它强制刷成深色卡面，
                      那样图标拖底在深色模式下就不是白的了。 */}
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-[#fff] shadow-sm">
                    <Icon className="size-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{plugin.name}</span>
                      <span className={enabled ? enabledBadgeClass : disabledBadgeClass}>{enabled ? "已启用" : "未启用"}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      {authorLogin ? (
                        <Avatar size="sm">
                          <AvatarImage src={githubAvatarUrl(authorLogin)} alt={`${plugin.author} 的 GitHub 头像`} />
                          <AvatarFallback>{plugin.author.slice(0, 1).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      ) : null}
                      <span className="truncate text-xs text-muted-foreground">{plugin.author}</span>
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
                </button>
              );
            })}
          </div>
        </AboutSection>

        <p className="mt-4 pb-2 text-center text-[11px] text-muted-foreground">
          Campux · 开源校园墙运营系统 · Apache License 2.0
        </p>
      </div>

      <Dialog open={activePlugin !== null} onOpenChange={(open) => { if (!open) setActivePlugin(null); }}>
        <DialogContent>
          {activePlugin ? (
            <PluginDetail
              plugin={activePlugin}
              enabled={pluginEnabledFlags[activePlugin.id](metadata)}
              authorLogin={authorGithubLogins[activePlugin.author]}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PluginDetail({ plugin, enabled, authorLogin }: { plugin: ShowcasePlugin; enabled: boolean; authorLogin: string | undefined }) {
  const Icon = plugin.icon;
  const authorChip = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
      {authorLogin ? (
        <Avatar size="sm">
          <AvatarImage src={githubAvatarUrl(authorLogin)} alt={`${plugin.author} 的 GitHub 头像`} />
          <AvatarFallback>{plugin.author.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      ) : null}
      {plugin.author}
    </span>
  );

  return (
    <>
      <DialogHeader>
        <div className="flex items-start gap-3">
          {/* 与列表一致：插件图标用白色底牌，图标保留自身品牌色。 */}
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-[#fff] shadow-sm">
            <Icon className="size-7" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="truncate">{plugin.name}</DialogTitle>
            <DialogDescription className="mt-1">{plugin.tagline}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div className="space-y-3 px-5 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={enabled ? enabledBadgeClass : disabledBadgeClass}>{enabled ? "已启用" : "未启用"}</span>
          {authorLogin ? (
            <a href={githubProfileUrl(authorLogin)} target="_blank" rel="noreferrer" className="hover:opacity-80">
              {authorChip}
            </a>
          ) : (
            authorChip
          )}
        </div>
        <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{plugin.detailedDescription}</p>
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">{plugin.hint}</p>
      </div>
    </>
  );
}

function AboutSection({ title, description, icon: Icon, accent = "blue", children }: { title: string; description?: string; icon: LucideIcon; accent?: SectionAccent; children: ReactNode }) {
  return (
    <section className="product-surface mt-3 p-4">
      <div className="flex items-start gap-3">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg border ${accentTileClass[accent]}`}>
          <Icon className="size-4" strokeWidth={2.1} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
