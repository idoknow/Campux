import { useState } from "react";
import type { FormEvent } from "react";
import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequiredPasswordChangeScreen({ busy, error, onChangePassword, onLogout }: { busy: boolean; error: string; onChangePassword: (newPassword: string) => Promise<void>; onLogout: () => void }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 6 || newPassword !== confirmPassword) {
      return;
    }
    await onChangePassword(newPassword);
  }

  return (
    <main className="min-h-dvh bg-background">
      <section className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 py-8">
        <div className="mb-5">
          <h1 className="inline-block pr-2 text-xl font-semibold leading-tight tracking-normal text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">修改初始密码</span>
        </div>

        <form className="product-surface px-4 py-5" onSubmit={submit}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md product-accent-amber">
              <KeyRoundIcon className="size-5" />
            </span>
            <div>
              <p className="text-lg font-semibold text-slate-950">请先设置新密码</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">你的账号通过校园墙机器人注册，初始密码是随机密码。首次登录后需要换成你自己的密码。</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <Input value={newPassword} type="password" placeholder="新密码，至少 6 位" onChange={(event) => setNewPassword(event.target.value)} />
            <Input value={confirmPassword} type="password" placeholder="再次输入新密码" onChange={(event) => setConfirmPassword(event.target.value)} />
          </div>
          {mismatch ? <p className="mt-3 text-sm font-medium text-red-600">两次输入的新密码不一致。</p> : null}
          {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
          <Button className="mt-5 w-full font-medium" disabled={busy || newPassword.length < 6 || newPassword !== confirmPassword} type="submit">
            {busy ? "保存中" : "保存并继续"}
          </Button>
          <Button className="mt-2 w-full font-medium" variant="ghost" type="button" disabled={busy} onClick={onLogout}>
            退出登录
          </Button>
        </form>
      </section>
    </main>
  );
}
