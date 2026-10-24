import { useState } from "react";
import { MailIcon, XIcon } from "lucide-react";

/**
 * 未绑定邮箱的常驻提醒横幅。
 *
 * 切换到无 Bot 模式后，邮箱是普通用户接收通知、自助找回密码的唯一渠道。
 * 这里只做提醒、不阻断功能，避免「没绑邮箱 ↔ 忘记密码」的死锁：
 * 用户随时可以到「服务 → 邮箱绑定」补绑。
 */
export function EmailBindBanner({ userId }: { userId: string }) {
  const storageKey = `campux:email-bind-banner-dismissed:${userId}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) {
    return null;
  }

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // 存储不可用时仅本次会话隐藏。
    }
    setDismissed(true);
  }

  function goBind() {
    // 带上 action，让服务页直接展开「邮箱绑定」面板。
    window.history.pushState(null, "", "/services?action=email-binding");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="mx-auto flex max-w-[980px] flex-wrap items-center gap-2">
        <MailIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={2.3} />
        <p className="min-w-0 flex-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
          你还没有绑定邮箱。绑定后可在忘记密码时通过邮件验证码自助重置密码；未绑定将无法通过邮件找回密码。
        </p>
        <button type="button" onClick={goBind} className="text-xs font-semibold text-amber-900 underline-offset-4 hover:underline dark:text-amber-100">
          去绑定
        </button>
        <button type="button" onClick={dismiss} aria-label="稍后提醒" className="text-amber-500 transition hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200">
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
