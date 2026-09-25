import { MoonIcon, SunIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme";
import { DropdownMenuLabel, DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * 日/月渐变外观开关：亮色一侧为蓝天渐变 + 太阳，暗色一侧为星空渐变 + 月球。
 * 点击在亮/暗之间切换；原本跟随系统的用户首次点击后转为显式模式。
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setMode } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="切换外观模式"
      title={dark ? "切换到亮色模式" : "切换到暗色模式"}
      onClick={() => setMode(dark ? "light" : "dark")}
      className={cn(
        "relative inline-flex h-8 w-[72px] shrink-0 cursor-pointer items-center rounded-full p-1 shadow-inner transition-colors duration-300 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        dark
          ? "bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 ring-1 ring-white/15"
          : "bg-gradient-to-r from-sky-400 via-cyan-300 to-sky-300 ring-1 ring-white/40",
        className,
      )}
    >
      {/* 星空点缀（暗色） */}
      <span aria-hidden className={cn("pointer-events-none absolute left-3 top-2 size-0.5 rounded-full bg-white/80 transition-opacity duration-300", dark ? "opacity-100" : "opacity-0")} />
      <span aria-hidden className={cn("pointer-events-none absolute left-9 top-3.5 size-1 rounded-full bg-white/70 transition-opacity duration-300", dark ? "opacity-100" : "opacity-0")} />
      <span aria-hidden className={cn("pointer-events-none absolute left-14 top-2 size-0.5 rounded-full bg-white/60 transition-opacity duration-300", dark ? "opacity-100" : "opacity-0")} />

      {/* 两端日月示意：滑块移开后露出对应天体 */}
      <SunIcon aria-hidden className={cn("pointer-events-none absolute left-1.5 size-4 text-amber-100 transition-opacity duration-300", dark ? "opacity-95" : "opacity-0")} />
      <MoonIcon aria-hidden className={cn("pointer-events-none absolute right-1.5 size-4 text-indigo-100 transition-opacity duration-300", dark ? "opacity-0" : "opacity-95")} />

      {/* 滑块：亮色为太阳、暗色为月球 */}
      <span
        aria-hidden
        className={cn(
          "relative z-10 grid size-6 place-items-center rounded-full bg-white shadow-md transition-transform duration-300",
          dark ? "translate-x-10" : "translate-x-0",
        )}
      >
        {dark ? <MoonIcon className="size-3.5 text-indigo-600" /> : <SunIcon className="size-3.5 text-amber-500" />}
      </span>
    </button>
  );
}

export function ThemeModeButton() {
  return <ThemeToggle />;
}

export function ThemeMenuItems() {
  const { resolvedTheme } = useTheme();

  return (
    <>
      <DropdownMenuLabel className="text-xs font-semibold text-slate-500">外观模式</DropdownMenuLabel>
      <DropdownMenuItem onSelect={(event) => event.preventDefault()} className="gap-2">
        <ThemeToggle />
        <span className="text-sm">{resolvedTheme === "dark" ? "暗色模式" : "亮色模式"}</span>
      </DropdownMenuItem>
    </>
  );
}
