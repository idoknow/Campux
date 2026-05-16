import { useState } from "react";
import type { FormEvent } from "react";
import type { TenantSummary } from "@campux/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginScreen({
  selectedTenant,
  error,
  onLogin,
}: {
  selectedTenant: TenantSummary | undefined;
  error: string;
  onLogin: (qqUin: string, password: string) => Promise<void>;
}) {
  const allowTestAccounts = import.meta.env.DEV;
  const [qqUin, setQqUin] = useState(allowTestAccounts ? "10000" : "");
  const [password, setPassword] = useState(allowTestAccounts ? "campux123" : "");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onLogin(qqUin, password);
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
          <p className="mt-2 text-sm leading-6 text-slate-600">输入通过校园墙机器人注册的账号和密码。</p>
          <div className="mt-5 grid gap-3">
            <Input value={qqUin} inputMode="numeric" placeholder="QQ 号 / UIN" onChange={(event) => setQqUin(event.target.value)} />
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
      </section>
    </main>
  );
}
