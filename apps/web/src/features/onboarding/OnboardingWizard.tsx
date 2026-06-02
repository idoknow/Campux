import { useCallback, useEffect, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, Loader2Icon, QrCodeIcon, RotateCcwIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { AdminBotAccount } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type WizardStep = "info" | "bot" | "publish" | "done";

const STEP_ORDER: WizardStep[] = ["info", "bot", "publish", "done"];
const STEP_LABELS: Record<WizardStep, string> = {
  info: "校园墙信息",
  bot: "接入墙号机器人",
  publish: "配置发布到空间",
  done: "完成",
};

type QrLoginState = {
  open: boolean;
  botId: string;
  loginId: string;
  qrImage: string;
  status: string;
  message: string;
};

export function OnboardingWizard({
  tenant,
  operatorName,
  onRefreshMe,
  onEnterWorkspace,
  onBackToTenants,
  onLogout,
}: {
  tenant: TenantSummary;
  operatorName: string | null;
  onRefreshMe: () => Promise<void>;
  onEnterWorkspace: () => void;
  onBackToTenants?: (() => void) | undefined;
  onLogout: () => void;
}) {
  const [step, setStep] = useState<WizardStep>("info");
  const [bots, setBots] = useState<AdminBotAccount[]>([]);
  const [loadingBots, setLoadingBots] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);

  const [name, setName] = useState(tenant.name);
  const [themeColor, setThemeColor] = useState(tenant.themeColor);
  const [banner, setBanner] = useState("");

  const [botQq, setBotQq] = useState("");
  const [botName, setBotName] = useState("");
  const [reviewGroup, setReviewGroup] = useState("");

  const [qrLogin, setQrLogin] = useState<QrLoginState>({ open: false, botId: "", loginId: "", qrImage: "", status: "", message: "" });

  const primaryBot = bots[0] ?? null;
  const botOnline = Boolean(primaryBot?.connection.online);
  const publishReady = Boolean(primaryBot?.sessions.some((session) => session.status === "available"));

  const refreshBots = useCallback(async () => {
    try {
      const data = await api<{ bots: AdminBotAccount[] }>("/api/admin/bots");
      setBots(data.bots);
      return data.bots;
    } finally {
      setLoadingBots(false);
    }
  }, []);

  useEffect(() => {
    void refreshBots().catch(() => setLoadingBots(false));
  }, [refreshBots]);

  // Load the current announcement so the info step shows what's already set.
  useEffect(() => {
    let ignore = false;
    void api<{ banner?: string }>("/api/tenant/metadata")
      .then((data) => {
        if (!ignore && typeof data.banner === "string") setBanner(data.banner);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  // While waiting for the bot to come online, poll so the operator sees the
  // connection flip to "已连接" without refreshing the page.
  useEffect(() => {
    if (step !== "bot" || !primaryBot || botOnline) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshBots().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [step, primaryBot, botOnline, refreshBots]);

  // Default the bot display name from the wall name once known.
  useEffect(() => {
    if (!botName) setBotName(`${tenant.name} 墙号`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.name]);

  async function saveInfo() {
    setSavingInfo(true);
    try {
      await api("/api/admin/tenant/metadata", {
        method: "PATCH",
        body: JSON.stringify({ tenantName: name.trim() || tenant.name, themeColor, banner }),
      });
      setStep("bot");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSavingInfo(false);
    }
  }

  async function createBot() {
    if (!/^\d{5,}$/.test(botQq.trim())) {
      toast.error("请输入正确的墙号 QQ");
      return;
    }
    setCreatingBot(true);
    try {
      await api("/api/admin/bots", {
        method: "POST",
        body: JSON.stringify({
          qqUin: botQq.trim(),
          displayName: botName.trim() || `${tenant.name} 墙号`,
          reviewGroupId: reviewGroup.trim() || undefined,
          reviewNotificationEnabled: true,
          createPublishTarget: true,
        }),
      });
      toast.success("墙号已创建，请在 NapCat 中接入。");
      await refreshBots();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "创建墙号失败");
    } finally {
      setCreatingBot(false);
    }
  }

  async function startQrLogin() {
    if (!primaryBot) return;
    try {
      const data = await api<{ id: string; qrImage: string; status: string; message: string | null }>(`/api/admin/bots/${primaryBot.id}/qzone-login`, { method: "POST" });
      setQrLogin({ open: true, botId: primaryBot.id, loginId: data.id, qrImage: data.qrImage, status: data.status, message: data.message ?? "请用墙号 QQ 扫码" });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "发起扫码登录失败");
    }
  }

  useEffect(() => {
    if (!qrLogin.open || qrLogin.status !== "pending" || !qrLogin.botId || !qrLogin.loginId) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const data = await api<{ status: string; message: string | null; cookieNames: string[] }>(`/api/admin/bots/${qrLogin.botId}/qzone-login/${qrLogin.loginId}`);
        setQrLogin((current) => ({ ...current, status: data.status, message: data.message ?? current.message }));
        if (data.status === "succeeded") {
          toast.success(`扫码登录完成，已获取 QZone cookies（${data.cookieNames.length} 项）。`);
          setQrLogin((current) => ({ ...current, open: false }));
          await refreshBots();
        }
      } catch {
        // keep polling
      }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [qrLogin.open, qrLogin.status, qrLogin.botId, qrLogin.loginId, refreshBots]);

  async function finish() {
    await onRefreshMe();
    onEnterWorkspace();
  }

  const currentIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-black text-slate-900 dark:text-slate-50">开通校园墙</p>
            <p className="truncate text-xs font-semibold text-slate-500">{tenant.name}{operatorName ? ` · ${operatorName}` : ""}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onBackToTenants ? (
              <Button variant="ghost" size="sm" onClick={onBackToTenants}>切换校园墙</Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onLogout}>退出</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <StepRail steps={STEP_ORDER} current={step} botOnline={botOnline} />

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {step === "info" ? (
            <section className="grid gap-4">
              <StepTitle index={1} title="校园墙信息" hint="给校园墙设置展示名称、主题色和顶部公告。" />
              <Field label="校园墙名称">
                <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：广州大学校园墙" />
              </Field>
              <Field label="主题色">
                <div className="flex items-center gap-2">
                  <input type="color" value={themeColor} onChange={(event) => setThemeColor(event.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-slate-200 bg-white" />
                  <Input value={themeColor} onChange={(event) => setThemeColor(event.target.value)} className="w-32" />
                </div>
              </Field>
              <Field label="顶部公告（可选）">
                <Textarea value={banner} onChange={(event) => setBanner(event.target.value)} maxLength={200} placeholder="例如：欢迎投稿，请遵守社区规范。" className="min-h-20" />
              </Field>
              <div className="flex justify-end">
                <Button disabled={savingInfo} onClick={() => void saveInfo()}>
                  {savingInfo ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                  下一步
                </Button>
              </div>
            </section>
          ) : null}

          {step === "bot" ? (
            <section className="grid gap-4">
              <StepTitle index={2} title="接入墙号机器人" hint="用墙号 QQ 登录 NapCat，并把连接地址填进去。连接成功即代表墙号通过认证。" />
              {loadingBots ? (
                <p className="text-sm font-semibold text-slate-500">正在读取墙号状态…</p>
              ) : !primaryBot ? (
                <div className="grid gap-3">
                  <Field label="墙号 QQ">
                    <Input value={botQq} onChange={(event) => setBotQq(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="负责发布的 QQ 号" />
                  </Field>
                  <Field label="墙号名称">
                    <Input value={botName} onChange={(event) => setBotName(event.target.value)} maxLength={80} />
                  </Field>
                  <Field label="审核群号（可选）">
                    <Input value={reviewGroup} onChange={(event) => setReviewGroup(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="接收新稿件和审核通知的 QQ 群" />
                  </Field>
                  <div className="flex justify-end">
                    <Button disabled={creatingBot} onClick={() => void createBot()}>
                      {creatingBot ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                      创建墙号
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <ConnectionPanel bot={primaryBot} online={botOnline} />
                  <NapCatGuide url={buildOneBotUrl(primaryBot)} />
                  <div className="flex items-center justify-between gap-2">
                    <Button variant="outline" size="sm" onClick={() => void refreshBots()}>
                      <RotateCcwIcon data-icon="inline-start" />
                      刷新状态
                    </Button>
                    <Button disabled={!botOnline} onClick={() => setStep("publish")}>下一步</Button>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {step === "publish" ? (
            <section className="grid gap-4">
              <StepTitle index={3} title="配置发布到 QQ 空间" hint="扫码登录墙号 QQ 空间，稿件审核通过后才能自动发布。可以稍后再配置。" />
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">QQ 空间登录态</p>
                    <p className="text-xs font-semibold text-slate-500">{publishReady ? "已就绪，可以发布说说。" : "还没有登录态，请扫码登录。"}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${publishReady ? "bg-green-50 text-green-700 ring-1 ring-green-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                    {publishReady ? "已就绪" : "待登录"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void startQrLogin()}>
                    <QrCodeIcon data-icon="inline-start" />
                    {publishReady ? "重新扫码登录" : "扫码登录"}
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("bot")}>上一步</Button>
                <div className="flex gap-2">
                  {!publishReady ? <Button variant="outline" onClick={() => setStep("done")}>稍后配置</Button> : null}
                  <Button onClick={() => setStep("done")}>下一步</Button>
                </div>
              </div>
            </section>
          ) : null}

          {step === "done" ? (
            <section className="grid gap-4 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-full bg-green-50 text-green-600 ring-1 ring-green-200">
                <CheckIcon className="size-6" />
              </div>
              <StepTitle index={4} title="开通完成" hint="墙号已接入，校园墙可以开始收稿了。" center />
              {!publishReady ? (
                <p className="text-xs font-semibold text-amber-600">提示：还没有配置 QQ 空间登录态，审核通过的稿件暂时无法自动发布。进入后可在「发布管理」补上。</p>
              ) : null}
              <div className="flex justify-center">
                <Button onClick={() => void finish()}>进入校园墙</Button>
              </div>
            </section>
          ) : null}
        </div>

        <p className="mt-4 text-center text-xs font-semibold text-slate-400">第 {currentIndex + 1} / {STEP_ORDER.length} 步</p>
      </main>

      <Dialog open={qrLogin.open} onOpenChange={(open) => setQrLogin((current) => ({ ...current, open }))}>
        <DialogContent className="w-[min(380px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>扫码登录 QQ 空间</DialogTitle>
            <DialogDescription>请用墙号 QQ 扫描二维码，确认后自动获取登录态。</DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-5">
            {qrLogin.qrImage ? <img src={qrLogin.qrImage} alt="QZone 登录二维码" className="mx-auto size-56 rounded-md border border-slate-200" /> : null}
            <p className="mt-3 text-center text-sm font-bold text-slate-600">{qrLogin.message || qrLogin.status}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StepRail({ steps, current, botOnline }: { steps: WizardStep[]; current: WizardStep; botOnline: boolean }) {
  const currentIndex = steps.indexOf(current);
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((stepKey, index) => {
        const done = index < currentIndex || (stepKey === "bot" && botOnline && current !== "bot");
        const active = stepKey === current;
        return (
          <div key={stepKey} className="flex flex-1 items-center gap-1.5">
            <div className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-bold ${active ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : done ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              {done ? <CheckIcon className="size-3.5" /> : index + 1}
            </div>
            <span className={`hidden truncate text-xs font-semibold sm:block ${active ? "text-slate-900 dark:text-slate-100" : "text-slate-400"}`}>{STEP_LABELS[stepKey]}</span>
            {index < steps.length - 1 ? <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function StepTitle({ index, title, hint, center }: { index: number; title: string; hint: string; center?: boolean }) {
  return (
    <div className={center ? "text-center" : ""}>
      <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">{title}</h2>
      <p className="mt-1 text-sm font-semibold text-slate-500">{hint}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function ConnectionPanel({ bot, online }: { bot: AdminBotAccount; online: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${online ? "border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-950/30" : "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"}`}>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">墙号 QQ {bot.qqUin}</p>
        <p className="text-xs font-semibold text-slate-500">{online ? "已连接 NapCat，墙号通过认证。" : "等待 NapCat 连接…保持这个页面打开。"}</p>
      </div>
      <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${online ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
        {online ? <CheckIcon className="size-3.5" /> : <Loader2Icon className="size-3.5 animate-spin" />}
        {online ? "已连接" : "等待连接"}
      </span>
    </div>
  );
}

function NapCatGuide({ url }: { url: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("连接地址已复制。");
    } catch {
      toast.error("复制失败，请手动选择复制。");
    }
  }
  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">在 NapCat 里添加「反向 WebSocket」客户端，把下面的地址粘贴进去：</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">{url}</code>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          <CopyIcon data-icon="inline-start" />
          复制
        </Button>
      </div>
      <ol className="ml-4 list-decimal text-xs font-semibold text-slate-500">
        <li>用墙号 QQ 登录 NapCat。</li>
        <li>新建反向 WebSocket 客户端，地址填上面这串。</li>
        <li>启用后这里会自动显示「已连接」。</li>
      </ol>
    </div>
  );
}

function buildOneBotUrl(bot: AdminBotAccount) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL("/onebot/v11/ws", `${protocol}//${window.location.host}`);
  url.searchParams.set("bot_id", bot.id);
  url.searchParams.set("token", bot.connectionToken);
  return url.toString();
}
