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
    <main className="min-h-dvh bg-white">
      <section className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pt-3 md:justify-center md:px-8 md:pt-0">
        <div className="md:mb-8">
          <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{selectedTenant?.name ?? "校园墙"}</span>
        </div>

        <form className="mt-12 rounded-md bg-sky-50 px-4 py-5 md:mt-0" onSubmit={handleSubmit}>
          <p className="text-xl font-bold text-slate-950">登录到 Campux</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">输入通过校园墙机器人注册的账号和密码。</p>
          <div className="mt-5 grid gap-3">
            <Input value={qqUin} inputMode="numeric" placeholder="QQ 号 / UIN" onChange={(event) => setQqUin(event.target.value)} />
            <Input value={password} type="password" placeholder="密码" onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
          <Button className="mt-5 rounded-full bg-[#42a5f5] px-8 font-bold hover:bg-[#42a5f5]" disabled={busy} type="submit">
            {busy ? "登录中" : "登录"}
          </Button>
          {allowTestAccounts ? (
            <div className="mt-4 text-xs leading-5 text-slate-500">
              <p>开发环境测试账号密码均为 `campux123`：</p>
              <p>10000 用户，20000 审核员，30000 多墙管理员，40000 系统运维。</p>
            </div>
          ) : null}
        </form>
      </section>
    </main>
  );
}
