import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoaderIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type MergePreview = {
  oldQqUin: string;
  oldEmail: string | null;
  oldDisplayName: string | null;
  oldPostCount: number;
  newQqUin: string;
};

/**
 * 「绑定之前的账号」引导。
 *
 * 触发时机：管理员切换过运营模式后，用户（且是第一次登录、还没绑过邮箱）
 * 登录时询问一次。用户可以直接跳过 —— 之后仍能在「服务」页找到入口。
 *
 * 关键规则（按运营者要求）：
 * - 邮箱绑定的 QQ 与当前登录账号 QQ 不一致时，明确提示并以「之前账号」为准；
 * - 绑定成功后，当前账号的 QQ 会被改成旧账号的 QQ（即「靠私聊 bot 创建的账号」的那个）。
 */
export function AccountMergeDialog({
  open,
  onClose,
  onMerged,
  currentQqUin,
}: {
  open: boolean;
  onClose: () => void;
  onMerged: () => Promise<void> | void;
  /** 当前账号 QQ，用于提示「不一致」。 */
  currentQqUin: string;
}) {
  const [oldQqUin, setOldQqUin] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    if (!open) {
      setOldQqUin("");
      setEmail("");
      setCode("");
      setPreview(null);
      setMessage("");
      setCodeSent(false);
    }
  }, [open]);

  async function loadPreview() {
    if (!/^[1-9]\d{4,11}$/.test(oldQqUin)) {
      setMessage("请输入正确的 QQ 号");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const data = await api<{ preview: MergePreview }>("/api/me/account-merge/preview", {
        method: "POST",
        body: JSON.stringify({ oldQqUin }),
      });
      setPreview(data.preview);
      setEmail(data.preview.oldEmail ?? "");
      // QQ 不一致时明确提示：绑定后当前账号的 QQ 会改成旧账号的。
      if (data.preview.oldQqUin !== currentQqUin) {
        setMessage(
          `邮箱绑定的 QQ（${data.preview.oldQqUin}）与当前登录账号（${currentQqUin}）不一致。`
          + "确认绑定后，当前账号的 QQ 会改为 " + data.preview.oldQqUin + "。",
        );
      }
    } catch (caught) {
      setPreview(null);
      setMessage(caught instanceof Error ? caught.message : "查询失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!preview) return;
    setSending(true);
    setMessage("");
    try {
      const data = await api<{ ok: boolean; email: string }>("/api/me/account-merge/request-code", {
        method: "POST",
        body: JSON.stringify({ oldQqUin, email: email || undefined }),
      });
      setCodeSent(true);
      setMessage(`验证码已发送到 ${data.email}，10 分钟内有效。`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "验证码发送失败");
    } finally {
      setSending(false);
    }
  }

  async function confirmMerge() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ ok: boolean; migratedPosts: number }>("/api/me/account-merge/confirm", {
        method: "POST",
        body: JSON.stringify({ oldQqUin, email: email || undefined, code: code.trim() }),
      });
      toast.success(`已绑定之前的账号，迁移了 ${result.migratedPosts} 条稿件。`);
      await onMerged();
      onClose();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>绑定之前的账号？</DialogTitle>
          <DialogDescription>
            校园墙的运营方式刚调整过。如果你在之前还注册过一个账号（用 QQ 号 + 邮箱注册的），
            可以把它绑定到当前账号，这样两边的稿件都会显示在一起。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 px-5 pb-5">
          <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
            之前账号的 QQ 号
            <div className="flex gap-2">
              <Input
                value={oldQqUin}
                inputMode="numeric"
                placeholder="例如 123456789"
                disabled={busy}
                onChange={(event) => {
                  setOldQqUin(event.target.value.replace(/\D/g, ""));
                  setPreview(null);
                  setCodeSent(false);
                }}
              />
              <Button variant="outline" disabled={busy || oldQqUin.length < 5} onClick={() => void loadPreview()}>
                查询
              </Button>
            </div>
          </label>

          {preview ? (
            <>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                <p>旧账号：QQ {preview.oldQqUin}{preview.oldDisplayName ? ` · ${preview.oldDisplayName}` : ""}</p>
                <p>可迁移稿件：{preview.oldPostCount} 条</p>
              </div>
              <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                验证邮箱
                <Input
                  value={email}
                  type="email"
                  placeholder="旧账号绑定的邮箱"
                  disabled={busy}
                  onChange={(event) => { setEmail(event.target.value); setCodeSent(false); }}
                />
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Input
                  value={code}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="邮箱验证码"
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <Button variant="outline" disabled={sending || email.trim().length === 0} onClick={() => void sendCode()}>
                  {sending ? "发送中" : codeSent ? "重新发送" : "发送验证码"}
                </Button>
              </div>
            </>
          ) : null}

          {message ? (
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs font-bold leading-5 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              {message}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              以后再说
            </Button>
            <Button
              disabled={busy || !preview || code.trim().length !== 6}
              onClick={() => void confirmMerge()}
            >
              {busy ? <LoaderIcon className="mr-1 size-4 animate-spin" /> : null}
              确认绑定
            </Button>
          </div>
          <p className="text-center text-xs font-semibold text-slate-400">
            也可以稍后在「服务 · 账号设置」里绑定。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
