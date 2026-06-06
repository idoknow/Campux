import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { api } from "@/lib/api";
import type { MeResponse } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DeployMode = "single" | "multi";
type WizardStep = "mode" | "admin" | "wall";

// First-run setup. Shown only when GET /api/setup/status reports needsSetup.
// Walks a brand-new self-hosted instance from "empty database" to "logged-in
// system operator" — the step that used to be impossible without manual SQL.
export function SetupWizard({ onComplete }: { onComplete: (data: MeResponse, deployMode: DeployMode) => void }) {
  const [step, setStep] = useState<WizardStep>("mode");
  const [deployMode, setDeployMode] = useState<DeployMode>("single");

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [wallName, setWallName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function goAdmin() {
    setStep("admin");
  }

  function adminNext() {
    if (displayName.trim().length === 0) {
      toast.error("请填写管理员名称");
      return;
    }
    if (password.length < 6) {
      toast.error("密码至少 6 位");
      return;
    }
    if (deployMode === "multi" && email.trim().length === 0) {
      toast.error("多租户模式下管理员邮箱必填");
      return;
    }
    setStep("wall");
  }

  async function finish() {
    if (deployMode === "single" && wallName.trim().length === 0) {
      toast.error("请填写校园墙名称");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        deployMode,
        displayName: displayName.trim(),
        password,
      };
      if (email.trim()) payload.email = email.trim();
      if (deployMode === "single") payload.wallName = wallName.trim();

      const data = await api<{ ok: true; deployMode: DeployMode }>("/api/setup/init", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const me = await api<MeResponse>("/api/me");
      toast.success("初始化完成。");
      onComplete(me, data.deployMode);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "初始化失败");
    } finally {
      setSubmitting(false);
    }
  }

  const steps: WizardStep[] = deployMode === "single" ? ["mode", "admin", "wall"] : ["mode", "admin", "wall"];
  const currentIndex = steps.indexOf(step);

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <img src="/logo.svg" alt="Campux" className="size-7" />
          <div>
            <p className="text-base font-black text-slate-900 dark:text-slate-50">初始化 Campux</p>
            <p className="text-xs font-semibold text-slate-500">首次部署 · 创建管理员账号</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <StepRail steps={steps} current={step} />

        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {step === "mode" ? (
            <section className="grid gap-4">
              <StepTitle title="选择部署模式" hint="决定这个实例怎么用。之后仍可在运维面板调整，但建议现在就选对。" />
              <ModeCard
                active={deployMode === "single"}
                badge="推荐"
                title="自用单墙模式"
                desc="只运营一个校园墙，你就是管理员。隐藏多租户概念，登录后直接进入唯一的墙，最省心。"
                onClick={() => setDeployMode("single")}
              />
              <ModeCard
                active={deployMode === "multi"}
                title="多租户运营平台模式"
                desc="像官方服务一样，允许多个运营者各自从管理端注册、自助开墙。会暴露校园墙选择页、管理端注册入口和运维面板。"
                onClick={() => setDeployMode("multi")}
              />
              <div className="flex justify-end">
                <Button onClick={goAdmin}>下一步</Button>
              </div>
            </section>
          ) : null}

          {step === "admin" ? (
            <section className="grid gap-4">
              <StepTitle
                title="创建管理员账号"
                hint={deployMode === "single" ? "这个账号是系统运维，也是你校园墙的管理员。" : "这个账号是系统运维，可进入运维面板管理整个实例。"}
              />
              <Field label={deployMode === "single" ? "邮箱（可选，用于找回）" : "邮箱"}>
                <Input value={email} type="email" placeholder={deployMode === "single" ? "可留空" : "运营管理员邮箱"} onChange={(event) => setEmail(event.target.value)} />
              </Field>
              <Field label="管理员名称">
                <Input value={displayName} maxLength={80} placeholder="例如：墙主" onChange={(event) => setDisplayName(event.target.value)} />
              </Field>
              <Field label="登录密码（至少 6 位）">
                <Input value={password} type="password" placeholder="设置一个安全的密码" onChange={(event) => setPassword(event.target.value)} />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("mode")}>上一步</Button>
                <Button onClick={adminNext}>下一步</Button>
              </div>
            </section>
          ) : null}

          {step === "wall" ? (
            <section className="grid gap-4">
              {deployMode === "single" ? (
                <>
                  <StepTitle title="创建你的校园墙" hint="给唯一的校园墙起个名字，初始化后直接进入它的工作台。" />
                  <Field label="校园墙名称">
                    <Input value={wallName} maxLength={80} placeholder="例如：广州大学校园墙" onChange={(event) => setWallName(event.target.value)} />
                  </Field>
                  <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    初始化后，进入工作台会有引导帮你接入墙号机器人和配置 QQ 空间发布。普通同学日后通过墙号机器人私聊注册即可投稿。
                  </p>
                </>
              ) : (
                <>
                  <StepTitle title="确认并完成" hint="多租户模式不在这里建墙。初始化后你会进入运维面板，从那里管理租户和运营者。" />
                  <div className="grid gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <Row k="部署模式" v="多租户运营平台" />
                    <Row k="管理端 host" v="已自动设为当前访问域名" />
                    <Row k="运营者注册" v="可从当前域名的登录页自助注册" />
                  </div>
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    如需运营者收到邮箱验证码，请在环境变量里配置 RESEND_API_KEY；未配置时验证码会直接显示在注册页面上。
                  </p>
                </>
              )}
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("admin")}>上一步</Button>
                <Button disabled={submitting} onClick={() => void finish()}>
                  {submitting ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
                  完成初始化
                </Button>
              </div>
            </section>
          ) : null}
        </div>

        <p className="mt-4 text-center text-xs font-semibold text-slate-400">第 {currentIndex + 1} / {steps.length} 步</p>
      </main>
    </div>
  );
}

function ModeCard({ active, badge, title, desc, onClick }: { active: boolean; badge?: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid gap-1 rounded-lg border p-4 text-left transition ${active ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200 dark:border-blue-500 dark:bg-blue-950/30" : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"}`}
    >
      <div className="flex items-center gap-2">
        <span className={`grid size-5 place-items-center rounded-full border ${active ? "border-blue-500 bg-blue-500 text-white" : "border-slate-300"}`}>
          {active ? <CheckIcon className="size-3.5" /> : null}
        </span>
        <span className="text-sm font-black text-slate-900 dark:text-slate-50">{title}</span>
        {badge ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">{badge}</span> : null}
      </div>
      <p className="pl-7 text-xs font-semibold leading-relaxed text-slate-500">{desc}</p>
    </button>
  );
}

function StepRail({ steps, current }: { steps: WizardStep[]; current: WizardStep }) {
  const labels: Record<WizardStep, string> = { mode: "部署模式", admin: "管理员", wall: "完成" };
  const currentIndex = steps.indexOf(current);
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((stepKey, index) => {
        const done = index < currentIndex;
        const active = stepKey === current;
        return (
          <div key={stepKey} className="flex flex-1 items-center gap-1.5">
            <div className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-bold ${active ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : done ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              {done ? <CheckIcon className="size-3.5" /> : index + 1}
            </div>
            <span className={`hidden truncate text-xs font-semibold sm:block ${active ? "text-slate-900 dark:text-slate-100" : "text-slate-400"}`}>{labels[stepKey]}</span>
            {index < steps.length - 1 ? <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function StepTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-slate-500">{k}</span>
      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{v}</span>
    </div>
  );
}
