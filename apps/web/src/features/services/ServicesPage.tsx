import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { BookOpenIcon, CheckIcon, ChevronRightIcon, ExternalLinkIcon, KeyRoundIcon, SparklesIcon, UserRoundIcon, WandSparklesIcon } from "lucide-react";
import { api } from "@/lib/api";
import { defaultMetadata } from "@/lib/app-model";
import { getBuiltInServiceEntryAction, isBuiltInServiceEntry, isSafeServiceEntryUrl } from "@/lib/service-entry-editor";
import type { AuthenticatedMe, TenantMetadata } from "@/types/app";
import { LoadingBlock } from "@/components/app/utility";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampaignsPage } from "./CampaignsPage";
import { CampaignDetailPage } from "./CampaignDetailPage";
import type { Campaign, CampaignFilter } from "./campaign-types";

function parseCampaignRoute(pathname: string, search: string) {
  if (!pathname.startsWith("/services/campaigns")) return null;
  const suffix = pathname.slice("/services/campaigns".length);
  const detailMatch = /^\/([^/?#]+)$/.exec(suffix);
  if (detailMatch) {
    return { view: "detail" as const, campaignId: decodeURIComponent(detailMatch[1] as string) };
  }
  const params = new URLSearchParams(search);
  const rawFilter = params.get("filter");
  const rawKeyword = params.get("q");
  const filter: CampaignFilter | undefined = rawFilter && (rawFilter === "active" || rawFilter === "ending_soon" || rawFilter === "ended" || rawFilter === "pending") ? rawFilter : undefined;
  return {
    view: "list" as const,
    filter,
    keyword: rawKeyword ?? undefined,
  };
}



type ServiceAction = "profile" | "password" | "rules" | "";

const servicePalettes = [
  {
    shell: "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/35",
    icon: "product-accent-blue",
  },
  {
    shell: "border-slate-200 bg-white hover:border-green-200 hover:bg-green-50/35",
    icon: "product-accent-green",
  },
  {
    shell: "border-slate-200 bg-white hover:border-amber-200 hover:bg-amber-50/35",
    icon: "product-accent-amber",
  },
  {
    shell: "border-slate-200 bg-white hover:border-rose-200 hover:bg-rose-50/35",
    icon: "product-accent-rose",
  },
];
const defaultServicePalette = {
  shell: "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/35",
  icon: "product-accent-blue",
};

export function ServicesPage({
  me,
  metadata,
  loading,
  onProfileSaved,
}: {
  me: AuthenticatedMe;
  metadata: TenantMetadata;
  loading: boolean;
  onProfileSaved: () => Promise<void>;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const sync = () => setTick((n) => n + 1);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  // pushState 不会触发 popstate，这里补一发事件，让本组件与 App 的路由监听都重算一次。
  function navigateTo(path: string) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setTick((n) => n + 1);
  }
  // Force re-read of window.location on each tick (used by pushState-driven navigation)
  void tick;
  const campaignRoute = parseCampaignRoute(window.location.pathname, window.location.search);
  const { accountServices, campusServices } = buildServiceEntries(metadata.services);
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;
  const [activeAction, setActiveAction] = useState<ServiceAction>("");

  if (campaignRoute && campaignRoute.view === "detail") {
    return (
      <CampaignDetailPage
        campaignId={campaignRoute.campaignId}
        me={me}
        metadata={metadata}
        onBack={() => navigateTo("/services/campaigns")}
      />
    );
  }
  if (campaignRoute && campaignRoute.view === "list") {
    return (
      <CampaignsPage
        me={me}
        metadata={metadata}
        initialFilter={campaignRoute.filter}
        initialKeyword={campaignRoute.keyword}
        onSelect={(campaign: Campaign) => navigateTo(`/services/campaigns/${encodeURIComponent(campaign.id)}`)}
      />
    );
  }

  function openService(service: TenantMetadata["services"][number]) {
    if (service.url) {
      if (!isSafeServiceEntryUrl(service.url)) {
        toast.error("服务链接无效，请联系管理员更新。");
        return;
      }
      window.open(service.url, "_blank", "noopener,noreferrer");
      return;
    }
    const builtInAction = getBuiltInServiceEntryAction(service);
    if (builtInAction) {
      setActiveAction(builtInAction);
      return;
    }

    toast.info(`${service.title} 还没有配置跳转链接。`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pt-4">
      <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
        {metadata.enableCampaigns ? (
          <button
            onClick={() => navigateTo("/services/campaigns")}
            className="mb-4 flex w-full items-center gap-4 rounded-xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-blue-50 to-pink-100 p-4 text-left shadow-sm transition hover:border-sky-300 hover:shadow-md"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-white bg-white/70 shadow-sm">
              <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="size-7" fill="none">
                <path d="M5.9 520h50l43.7 62.2h-50z" fill="#FD643A" />
                <path d="M1009.7 357.9l8.4 24.9-26.9 22.9-8.3-24.9z" fill="#FD9E1C" />
                <path d="M860.2 954.1H70.6c-23.6 0-42.7-19.1-42.7-42.7l64-170.7c0-23.6 19.1-42.7 42.7-42.7h682.9c23.6 0 42.7 19.1 42.7 42.7l42.7 170.7c0 23.6-19.1 42.7-42.7 42.7z" fill="#90C261" />
                <path d="M694.9 854.7H250.2c-11.9 0-21.5-9.6-21.5-21.5s9.6-21.5 21.5-21.5h444.7c11.9 0 21.5 9.6 21.5 21.5s-9.6 21.5-21.5 21.5z" fill="#FFFFFF" />
                <path d="M830 514L576.4 767.5c-56 56-146.8 56-202.9 0l-164-164.1c-56-56-56-146.8 0-202.9L463.1 147c56-56 146.8-56 202.9 0l164 164.1c56 56 56 146.8 0 202.9z" fill="#FD7D24" />
                <path d="M768.5 487.1L545.3 710.2c-42 42-110.1 42-152.1 0L267.1 584.1c-42-42-42-110.1 0-152.1l223.1-223.1c42-42 110.1-42 152.1 0L768.4 335c42.1 41.9 42.1 110.1 0.1 152.1z" fill="#FFCA28" />
                <path d="M780 638h26.2l13.1 32.7h-26.2z" fill="#FD9E1C" />
                <path d="M530.7 548.6l-118-108.4c-7.2-7.2-19-7.2-26.2 0-7.2 7.2-7.2 18.8 0 26l104.8 121.4c7.2 7.2 23.3 2.8 30.6-4.3 7.3-7.2 16-27.6 8.8-34.7z" fill="#FFFFFF" />
                <path d="M696.6 375.1c-7.2-7.2-19-7.2-26.2 0L478.2 548.6c-7.2 7.2-2.9 23.2 4.4 30.4 7.2 7.2 27.7 15.9 34.9 8.7l179.1-186.4c7.3-7.3 7.3-19 0-26.2z" fill="#FFFFFF" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold text-sky-950">投票竞选</span>
              <span className="mt-0.5 block text-xs text-sky-900/60">浏览正在进行的投票竞选，查看排名或参与投票。</span>
            </span>
            <ChevronRightIcon className="size-5 shrink-0 text-sky-400" />
          </button>
        ) : null}
        {loading ? <LoadingBlock title="正在加载服务入口..." /> : null}

        <section className="product-surface p-4">
          <ServiceGroup title="账户设置" description="管理你在当前校园墙里的基本账号信息。">
            {accountServices.map((service, index) => (
              <ServiceTile key={service.title} service={service} index={index} compact onOpen={() => openService(service)} />
            ))}
          </ServiceGroup>

          {campusServices.length > 0 ? (
            <ServiceGroup title="校园入口" description="由当前校园墙管理员维护的常用入口。">
              {campusServices.map((service, index) => (
                <ServiceTile key={service.title} service={service} index={index + accountServices.length} onOpen={() => openService(service)} />
              ))}
            </ServiceGroup>
          ) : null}
        </section>

        {activeAction === "profile" ? <ProfilePanel me={me} onSaved={onProfileSaved} /> : null}
        {activeAction === "password" ? <PasswordPanel onDone={(message) => toast.success(message)} /> : null}
        {activeAction === "rules" ? <RulesPanel rules={rules} /> : null}
      </div>
    </div>
  );
}

function buildServiceEntries(services: TenantMetadata["services"]) {
  const builtInServices = defaultMetadata.services.filter(isBuiltInServiceEntry);
  const customServices = services.filter((service) => !isBuiltInServiceEntry(service));
  return {
    accountServices: builtInServices,
    campusServices: customServices,
  };
}

function ServiceGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function ServiceTile({ service, index, compact = false, onOpen }: { service: TenantMetadata["services"][number]; index: number; compact?: boolean; onOpen: () => void }) {
  const palette = servicePalettes[index % servicePalettes.length] ?? defaultServicePalette;
  const Icon = pickServiceIcon(service.title);

  return (
    <button className={`flex items-center gap-3 rounded-md border p-3 text-left shadow-none transition ${compact ? "min-h-16" : "min-h-20"} ${palette.shell}`} onClick={onOpen}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${palette.icon}`}>
        <Icon className="size-5" strokeWidth={2.1} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-950">{service.title}</span>
        <span className="mt-0.5 block text-sm leading-5 text-slate-600">{service.description ?? "校园服务"}</span>
      </span>
      {service.url ? <ExternalLinkIcon className="size-4 shrink-0 text-slate-400" /> : <ChevronRightIcon className="size-4 shrink-0 text-slate-400" />}
    </button>
  );
}

function ProfilePanel({ me, onSaved }: { me: AuthenticatedMe; onSaved: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(me.user.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const normalizedName = displayName.trim();

  async function submit() {
    setBusy(true);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: normalizedName }),
      });
      await onSaved();
      toast.success("账户名称已更新。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-surface mt-4 p-4">
      <div className="flex items-center gap-2">
        <UserRoundIcon className="size-5 text-slate-500" />
        <p className="text-base font-semibold">修改名称</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input placeholder="账户名称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        <Button className="w-full font-medium sm:w-auto" disabled={busy || normalizedName.length === 0 || normalizedName === (me.user.displayName ?? "")} onClick={() => void submit()}>
          <CheckIcon data-icon="inline-start" />
          保存名称
        </Button>
      </div>
      <p className="mt-2 text-xs font-semibold text-slate-500">当前 QQ：{me.user.qqUin}</p>
    </section>
  );
}

function PasswordPanel({ onDone }: { onDone: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      onDone("密码已更新。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-surface mt-4 p-4">
      <div className="flex items-center gap-2">
        <KeyRoundIcon className="size-5 text-slate-500" />
        <p className="text-base font-semibold">修改密码</p>
      </div>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Input type="password" name="currentPassword" placeholder="当前密码" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <Input type="password" name="newPassword" placeholder="新密码，至少 6 位" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
      </form>
      <Button className="mt-3 w-full font-medium sm:w-auto" type="submit" disabled={busy || currentPassword.length === 0 || newPassword.length < 6} onClick={() => void submit()}>
        <CheckIcon data-icon="inline-start" />
        保存新密码
      </Button>
    </section>
  );
}

function RulesPanel({ rules }: { rules: string[] }) {
  return (
    <section className="product-surface mt-4 p-4">
      <div className="flex items-center gap-2">
        <BookOpenIcon className="size-5 text-slate-500" />
        <p className="text-base font-semibold">投稿规则</p>
      </div>
      <div className="mt-3 grid gap-2">
        {rules.map((rule, index) => (
          <p key={rule} className="rounded-md border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
            {index + 1}. {rule}
          </p>
        ))}
      </div>
    </section>
  );
}

function pickServiceIcon(title: string) {
  if (title.includes("名称") || title.includes("昵称")) {
    return UserRoundIcon;
  }
  if (title.includes("密码") || title.includes("账号")) {
    return KeyRoundIcon;
  }
  if (title.includes("规则") || title.includes("指南") || title.includes("文档")) {
    return BookOpenIcon;
  }
  if (title.includes("推荐") || title.includes("活动")) {
    return WandSparklesIcon;
  }
  return SparklesIcon;
}
