import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "./theme";
import type { ThemeMode } from "./theme";
import { DropdownMenuLabel, DropdownMenuItem } from "@/components/ui/dropdown-menu";

const modeLabels: Record<ThemeMode, string> = {
  light: "亮色模式",
  dark: "暗色模式",
  system: "跟随系统",
};

/**
 * 日/月/系统三态外观开关：亮色一侧为蓝天渐变 + 太阳，暗色一侧为星空渐变 + 月球，
 * 中间档为跟随系统（显示器图标，底色随当前解析出的亮/暗渐变变化）。
 * 点击按 亮色 → 跟随系统 → 暗色 → 亮色 循环。
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, resolvedTheme, setMode } = useTheme();
  const dark = resolvedTheme === "dark";
  const nextMode: ThemeMode = mode === "light" ? "system" : mode === "system" ? "dark" : "light";
  const knobOffset = mode === "system" ? 28 : dark ? 56 : 0;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={`外观模式：${modeLabels[mode]}，点击切换为${modeLabels[nextMode]}`}
      title={`外观模式：${modeLabels[mode]}（点击切换为${modeLabels[nextMode]}）`}
      onClick={() => setMode(nextMode)}
      className={`relative inline-flex h-9 w-[96px] shrink-0 cursor-pointer items-center rounded-full p-1 shadow-inner transition-all duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ring-1 ${dark ? "ring-white/10" : "ring-white/50"} ${className}`}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-gradient-to-br from-[#b3d9ff] via-[#cfe6ff] to-[#ffe9a8] transition-opacity duration-700 ease-[cubic-bezier(0.65,0,0.35,1)]"
        style={{ opacity: dark ? 0 : 1 }}
      />
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-gradient-to-br from-[#1f2a44] via-[#22264b] to-[#2d3561] transition-opacity duration-700 ease-[cubic-bezier(0.65,0,0.35,1)]"
        style={{ opacity: dark ? 1 : 0 }}
      />
      <span aria-hidden className={`pointer-events-none absolute left-3 top-2 size-1 rounded-full bg-white/80 shadow-[0_0_4px_1px_rgba(255,255,255,0.8)] transition-opacity duration-500 ${dark ? "opacity-100" : "opacity-0"}`} />
      <span aria-hidden className={`pointer-events-none absolute left-[28px] top-3.5 size-0.5 rounded-full bg-white/70 transition-opacity duration-500 ${dark ? "opacity-100" : "opacity-0"}`} />
      <span aria-hidden className={`pointer-events-none absolute left-[44px] top-2 size-0.5 rounded-full bg-white/60 transition-opacity duration-500 ${dark ? "opacity-100" : "opacity-0"}`} />
      <span aria-hidden className={`pointer-events-none absolute right-3 top-2.5 size-1 rounded-full bg-white/70 transition-opacity duration-500 ${dark ? "opacity-100" : "opacity-0"}`} />

      <span
        aria-hidden
        className="absolute top-1 z-10 grid size-7 place-items-center rounded-full transition-transform duration-700 ease-[cubic-bezier(0.65,0,0.35,1)]"
        style={{
          transform: `translateX(${knobOffset}px)`,
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-full transition-all duration-700 ease-[cubic-bezier(0.65,0,0.35,1)]"
          style={mode === "system" ? {
            background: "radial-gradient(circle at 30% 30%, #f1f5f9 0%, #dbe2ea 55%, #b6c2cf 100%)",
            boxShadow: "0 2px 10px rgba(15,23,42,0.3), inset 2px 2px 6px rgba(255,255,255,0.6)",
          } : dark ? {
            background: "radial-gradient(circle at 30% 30%, #f5f3e1 0%, #e8e4c0 55%, #c9c498 100%)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.4), inset -4px -4px 8px rgba(0,0,0,0.25)",
          } : {
            background: "radial-gradient(circle at 30% 30%, #fff7c2 0%, #ffd84d 55%, #ffb800 100%)",
            boxShadow: "0 2px 12px rgba(255,180,0,0.5), 0 0 20px rgba(255,200,80,0.4)",
          }}
        />
        <span aria-hidden className={`absolute transition-opacity duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${mode === "light" ? "opacity-100" : "opacity-0"}`}>
          <SunIcon className="size-4 text-amber-600" />
        </span>
        <span aria-hidden className={`absolute transition-opacity duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${mode === "system" ? "opacity-100" : "opacity-0"}`}>
          <MonitorIcon className="size-4 text-slate-600" />
        </span>
        <span aria-hidden className={`absolute transition-opacity duration-700 ease-[cubic-bezier(0.65,0,0.35,1)] ${mode === "dark" ? "opacity-100" : "opacity-0"}`}>
          <MoonIcon className="size-4 text-indigo-900/70" />
        </span>
        {mode === "dark" ? (
          <span aria-hidden className="relative grid size-7 place-items-center">
            <span className="absolute left-[9px] top-[7px] size-1 rounded-full bg-black/10" />
            <span className="absolute left-[18px] top-[15px] size-1 rounded-full bg-black/10" />
            <span className="absolute left-[12px] top-[18px] size-0.5 rounded-full bg-black/10" />
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ThemeModeButton() {
  return <ThemeToggle />;
}

export function ThemeMenuItems() {
  const { mode, resolvedTheme } = useTheme();

  return (
    <>
      <DropdownMenuLabel className="text-xs font-semibold text-slate-500">外观模式</DropdownMenuLabel>
      <DropdownMenuItem onSelect={(event) => event.preventDefault()} className="gap-2">
        <ThemeToggle />
        <span className="text-sm">
          {mode === "system" ? `跟随系统（当前${resolvedTheme === "dark" ? "暗色" : "亮色"}）` : modeLabels[mode]}
        </span>
      </DropdownMenuItem>
    </>
  );
}
