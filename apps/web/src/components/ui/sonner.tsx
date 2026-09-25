import { useEffect } from "react";
import { Toaster as Sonner, toast } from "sonner";
import type { ToasterProps } from "sonner";
import { useTheme } from "@/features/theme/theme";

function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  // sonner 2.x 的 Toaster/Toast 没有 onClick 属性，用事件委托实现：
  // 点击 error/warning toast 即复制其文本（右上角报错提示点一下可复制）。
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const toastEl = target.closest("[data-sonner-toast]") as HTMLElement | null;
      if (!toastEl) return;
      const type = toastEl.getAttribute("data-type");
      if (type !== "error" && type !== "warning") return;
      // 关闭 / 操作按钮的点击不触发复制
      if (target.closest("[data-button]")) return;
      const text = (toastEl.textContent ?? "").trim();
      if (!text) return;
      void navigator.clipboard
        .writeText(text)
        .then(() => toast.success("报错内容已复制"))
        .catch(() => undefined);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <Sonner
      position="top-right"
      theme={resolvedTheme}
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "max-w-[calc(100vw-2rem)] rounded-md border border-slate-200 bg-white text-slate-950 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50",
          title: "text-sm font-semibold",
          description: "text-sm text-slate-600 dark:text-slate-300",
          actionButton: "rounded-md bg-slate-950 px-2 py-1 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-950",
          cancelButton: "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
