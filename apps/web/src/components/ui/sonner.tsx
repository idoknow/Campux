import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";
import { useTheme } from "@/features/theme/theme";

function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

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
