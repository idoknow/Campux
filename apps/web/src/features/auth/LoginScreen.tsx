import { useState } from "react";
import type { FormEvent } from "react";
import type { TenantSummary } from "@campux/domain";
import { api } from "@/lib/api";
import type { MeResponse } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginScreen({
  selectedTenant,
  error,
  managementHost,
  onLogin,
  onRegistered,
}: {
  selectedTenant: TenantSummary | undefined;
  error: string;
  managementHost: boolean;
  onLogin: (account: string, password: string) => Promise<void>;
  onRegistered: (data: MeResponse) => void;
}) {
  const allowTestAccounts = import.meta.env.DEV;
  const [account, setAccount] = useState(allowTestAccounts ? "10000" : "");
  const [password, setPassword] = useState(allowTestAccounts ? "campux123" : "");
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onLogin(account, password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background">
      <section className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 py-8">
        <div className="mb-5">
          <h1 className="inline-block pr-2 text-xl font-semibold leading-tight tracking-normal text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{selectedTenant?.name ?? "校园墙"}</span>
        </div>

        <form className="product-surface px-4 py-5" onSubmit={handleSubmit}>
          <p className="text-lg font-semibold text-slate-950">登录到 Campux</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">输入 QQ 号或邮箱，以及你的账号密码。</p>
          <div className="mt-5 grid gap-3">
            <Input value={account} placeholder="QQ 号 / 邮箱" onChange={(event) => setAccount(event.target.value)} />
            <Input value={password} type="password" placeholder="密码" onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
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
            <button type="button" className="text-sm font-semibold text-blue-700" onClick={() => setRegisterOpen((value) => !value)}>
              {registerOpen ? "收起注册" : "注册运营管理员账号"}
            </button>
            {registerOpen ? <RegisterPanel onRegistered={onRegistered} /> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function RegisterPanel({ onRegistered }: { onRegistered: (data: MeResponse) => void }) {
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
