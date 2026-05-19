import { useState } from "react";
import type { FormEvent } from "react";
import type { TenantSummary } from "@campux/domain";
import { api } from "@/lib/api";
import type { MeResponse } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ThemeModeButton } from "@/features/theme/ThemeModeControl";

const CREDENTIALS_KEY = "campux.loginCredentials.v1";

function readSavedCredentials(): { account: string; password: string } | null {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "account" in parsed &&
      "password" in parsed &&
      typeof (parsed as { account: unknown }).account === "string" &&
      typeof (parsed as { password: unknown }).password === "string"
    ) {
      return parsed as { account: string; password: string };
    }
    return null;
  } catch {
    return null;
  }
}

function saveCredentials(account: string, password: string) {
  try {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ account, password }));
  } catch {
    // Storage unavailable; login should still work.
  }
}

function clearSavedCredentials() {
  try {
    localStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // Storage unavailable; login should still work.
  }
}

export function LoginScreen({
  hostTenant,
  logoUrl,
  error,
  managementHost,
  onLogin,
  onRegistered,
}: {
  hostTenant: TenantSummary | undefined;
  logoUrl: string;
  error: string;
  managementHost: boolean;
  onLogin: (account: string, password: string) => Promise<MeResponse>;
  onRegistered: (data: MeResponse) => void;
}) {
  const allowTestAccounts = import.meta.env.DEV;
  const title = hostTenant?.name ?? "Campux";
  const registerTenantName = hostTenant?.name ?? "Campux";

  const [savedCredentials] = useState(readSavedCredentials);
  const [account, setAccount] = useState(() => savedCredentials?.account ?? (allowTestAccounts ? "10000" : ""));
  const [password, setPassword] = useState(() => savedCredentials?.password ?? (allowTestAccounts ? "campux123" : ""));
  const [remember, setRemember] = useState(() => savedCredentials !== null);
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [loginError, setLoginError] = useState("");
  const displayError = loginError || error;

  function handleRememberChange(checked: boolean) {
    setRemember(checked);
    if (!checked) {
      clearSavedCredentials();
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    setBusy(true);
    try {
      const data = await onLogin(account, password);
      if (data.authenticated && !data.user.passwordChangeRequired && remember) {
        saveCredentials(account, password);
      }
    } catch (caught) {
      setLoginError(caught instanceof Error ? caught.message : "登录失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  function handleAccountChange(value: string) {
    setAccount(value);
    setLoginError("");
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setLoginError("");
  }

  return (
    <main className="min-h-dvh bg-background">
      <div className="fixed right-4 top-4 z-10">
        <ThemeModeButton />
      </div>
      <section className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 py-8">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-13 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <img src={logoUrl} alt={`${title} logo`} className="h-full w-full object-contain p-2" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold leading-tight tracking-normal text-slate-950">{title}</h1>
            {hostTenant ? (
              <span className="block truncate text-sm text-slate-600">
                由
                <a className="mx-1 font-medium text-blue-700 hover:underline" href="https://github.com/idoknow/Campux" target="_blank" rel="noreferrer">
                  Campux
                </a>
                提供技术支持
              </span>
            ) : null}
          </div>
        </div>

        <form className="product-surface px-4 py-5" onSubmit={handleSubmit}>
          <p className="text-lg font-semibold text-slate-950">登录到 Campux</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">输入 QQ 号或邮箱，以及你的账号密码。</p>
          <div className="mt-5 grid gap-3">
            <Input value={account} name="username" autoComplete="username" placeholder="QQ 号 / 邮箱" onChange={(event) => handleAccountChange(event.target.value)} />
            <Input value={password} name="password" autoComplete="current-password" type="password" placeholder="密码" onChange={(event) => handlePasswordChange(event.target.value)} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Switch id="remember-credentials" checked={remember} onCheckedChange={handleRememberChange} size="sm" />
            <label htmlFor="remember-credentials" className="cursor-pointer select-none text-sm text-slate-700">记住账号和密码</label>
            <span className="text-xs text-slate-400">仅保存在当前浏览器。</span>
          </div>
          {displayError ? <p className="mt-3 text-sm font-medium text-red-600">{displayError}</p> : null}
          <Button className="mt-5 w-full font-medium" disabled={busy} type="submit">
            {busy ? "登录中" : "登录"}
          </Button>
          {allowTestAccounts ? (
            <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-600">开发测试账号</summary>
              <p className="mt-2">密码均为 `campux123`。</p>
              <p>10000 用户，20000 审核员，30000 多墙管理员，40000 系统运维，50000 运营管理员。</p>
            </details>
          ) : null}
        </form>

        {managementHost ? (
          <div className="mt-3 product-surface px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-950">墙号运营者第一次使用？</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  这个注册入口只面向要创建校园墙的运营者。普通用户请通过对应校园墙机器人注册，已有账号可直接登录。
                </p>
              </div>
              <button type="button" className="shrink-0 text-sm font-semibold text-blue-700" onClick={() => setRegisterOpen((value) => !value)}>
                {registerOpen ? "收起注册" : "注册"}
              </button>
            </div>
            <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600">
              <p className="rounded-md bg-slate-50 px-3 py-2">运营者：邮箱验证码注册，进入运营面板创建校园墙。</p>
              <p className="rounded-md bg-slate-50 px-3 py-2">校园墙成员：登录后只进入自己被授权的校园墙。</p>
              <p className="rounded-md bg-slate-50 px-3 py-2">系统运维：继续使用已有运维账号进入全局运维面板。</p>
            </div>
            {registerOpen ? <RegisterPanel logoUrl={logoUrl} selectedTenantName={registerTenantName} onRegistered={onRegistered} /> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function RegisterPanel({ logoUrl, selectedTenantName, onRegistered }: { logoUrl: string; selectedTenantName: string; onRegistered: (data: MeResponse) => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  async function requestCode() {
    setSendingCode(true);
    setMessage("");
    try {
      const data = await api<{ ok: true; devCode?: string }>("/api/auth/register/request-code", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(data.devCode ? `开发环境验证码：${data.devCode}` : "验证码已发送，请检查邮箱。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "验证码发送失败");
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const data = await api<MeResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, displayName, password, code }),
      });
      onRegistered(data);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "注册失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 grid gap-3" onSubmit={submit}>
      <div className="mb-1 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          <img src={logoUrl} alt={`${selectedTenantName} logo`} className="h-full w-full object-contain p-1.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-950">注册运营管理员账号</p>
          <p className="truncate text-xs text-slate-500">{selectedTenantName}</p>
        </div>
      </div>
      <Input value={email} type="email" placeholder="邮箱" onChange={(event) => setEmail(event.target.value)} />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input value={code} inputMode="numeric" placeholder="邮箱验证码" onChange={(event) => setCode(event.target.value)} />
        <Button type="button" variant="outline" disabled={sendingCode || email.trim().length === 0} onClick={() => void requestCode()}>
          {sendingCode ? "发送中" : "获取验证码"}
        </Button>
      </div>
      <Input value={displayName} placeholder="账户名称" onChange={(event) => setDisplayName(event.target.value)} />
      <Input value={password} type="password" placeholder="密码，至少 6 位" onChange={(event) => setPassword(event.target.value)} />
      {message ? <p className="text-sm font-medium text-slate-600">{message}</p> : null}
      <Button className="font-medium" disabled={busy || email.trim().length === 0 || code.trim().length !== 6 || displayName.trim().length === 0 || password.length < 6} type="submit">
        {busy ? "注册中" : "注册并进入运营管理"}
      </Button>
    </form>
  );
}
