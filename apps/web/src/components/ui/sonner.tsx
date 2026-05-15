import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "rounded-md border border-slate-200 bg-white text-slate-950 shadow-lg",
          title: "text-sm font-semibold",
          description: "text-sm text-slate-600",
          actionButton: "rounded-md bg-slate-950 px-2 py-1 text-xs font-semibold text-white",
          cancelButton: "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
