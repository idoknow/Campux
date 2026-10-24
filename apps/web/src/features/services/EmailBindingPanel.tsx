import { useState } from "react";
import { toast } from "sonner";
import { MailIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BindCodeResponse {
  ok: boolean;
  email: string;
  expiresInSeconds: number;
  devCode?: string;
}

/**
 * 账户设置页的「邮箱绑定」面板。
 *
 * 切换到无 Bot 模式后，普通用户只能靠邮箱接收通知、自助找回密码，
 * 所以这里提供一个登录后可自助绑定/更换邮箱的入口（原先 email 只能在注册时写入一次）。
 */
export function EmailBindingPanel({ email, onDone }: { email: string | null; onDone?: () => void }) {
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [unbindPassword, setUnbindPassword] = useState("");
  const [unbindBusy, setUnbindBusy] = useState(false);

  async function requestCode() {
    const value = target.trim();
    if (!value) {
      toast.error("请先输入要绑定的邮箱");
      return;
    }
    setBusy(true);
    try {
      const data = await api<BindCodeResponse>("/api/auth/email/bind/request-code", {
        method: "POST",
        body: JSON.stringify({ email: value }),
      });
      setSentTo(data.email);
      setDevCode(data.devCode ?? null);
      setCode("");
      toast.success(data.devCode ? "当前未配置邮件服务，验证码见下方提示。" : "验证码已发送，请查收邮件。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "获取验证码失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmBind() {
    const value = target.trim();
    if (!value || !/^\d{6}$/.test(code.trim())) {
      toast.error("请输入邮箱和 6 位验证码");
      return;
    }
    setBusy(true);
    try {
      await api<{ ok: true; email: string }>("/api/auth/email/bind", {
        method: "POST",
        body: JSON.stringify({ email: value, code: code.trim() }),
      });
      setTarget("");
      setCode("");
      setSentTo(null);
      setDevCode(null);
      toast.success("邮箱绑定成功。");
      onDone?.();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  }

  async function unbind() {
    if (!unbindPassword) {
      toast.error("请输入当前密码确认解绑");
      return;
    }
    setUnbindBusy(true);
    try {
      await api<{ ok: true }>("/api/auth/email/unbind", {
        method: "POST",
        body: JSON.stringify({ password: unbindPassword }),
      });
      setUnbindPassword("");
      toast.success("已解绑邮箱。");
      onDone?.();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "解绑失败");
    } finally {
      setUnbindBusy(false);
    }
  }

  const codeReady = /^\d{6}$/.test(code.trim());

  return (
    <section className="product-surface mt-4 p-4">
      <div className="flex items-center gap-2">
        <MailIcon className="size-5 text-slate-500" />
        <p className="text-base font-semibold">邮箱绑定</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        绑定邮箱后，你可以在「忘记密码」时通过邮件验证码自助重置密码。无 Bot 模式下这是账号重要的联系方式。
      </p>

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        {email
          ? `当前绑定邮箱：${email}`
          : "尚未绑定邮箱。切换无 Bot 模式后将无法自助找回密码。"}
      </div>

      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void (sentTo ? confirmBind() : requestCode());
        }}
      >
        <Input
          type="email"
          placeholder="要绑定的邮箱"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            // 改了邮箱就作废上一轮的发码状态，避免把 A 邮箱的验证码用到 B 邮箱上。
            setSentTo(null);
            setDevCode(null);
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="6 位验证码" value={code} onChange={(event) => setCode(event.target.value)} />
          <Button type="button" variant="outline" disabled={busy || !target.trim()} onClick={() => void requestCode()}>
            {sentTo ? "重新发送" : "获取验证码"}
          </Button>
        </div>
      </form>

      {devCode ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          当前未配置邮件服务，验证码：{devCode}（10 分钟内有效）。
        </p>
      ) : null}
      {sentTo && !devCode ? <p className="mt-2 text-xs text-slate-500">验证码已发送到 {sentTo}，10 分钟内有效。</p> : null}

      <Button
        className="mt-3 w-full font-medium sm:w-auto"
        disabled={busy || !target.trim() || !codeReady}
        onClick={() => void confirmBind()}
      >
        绑定邮箱
      </Button>

      {email ? (
        <div className="mt-5 border-t border-slate-100 pt-3">
          <p className="text-sm font-semibold text-slate-900">解绑邮箱</p>
          <p className="mt-1 text-xs text-slate-500">解绑后将无法通过邮件找回密码，需要输入当前密码确认。</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              type="password"
              placeholder="当前密码"
              value={unbindPassword}
              onChange={(event) => setUnbindPassword(event.target.value)}
            />
            <Button variant="outline" disabled={unbindBusy || !unbindPassword} onClick={() => void unbind()}>
              解绑邮箱
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
