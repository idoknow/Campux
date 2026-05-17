import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ThemeMode } from "./theme";
import { useTheme } from "./theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themeOptions: Array<{ value: ThemeMode; label: string; description: string; icon: typeof SunIcon }> = [
  { value: "light", label: "亮色", description: "始终使用亮色界面", icon: SunIcon },
  { value: "dark", label: "暗色", description: "始终使用暗色界面", icon: MoonIcon },
  { value: "system", label: "自动", description: "跟随系统外观", icon: MonitorIcon },
];

export function ThemeModeButton({ align = "end" }: { align?: "start" | "center" | "end" }) {
  const { mode, resolvedTheme, setMode } = useTheme();
  const ActiveIcon = resolvedTheme === "dark" ? MoonIcon : SunIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="切换外观">
          <ActiveIcon data-icon="inline-start" />
          <span className="hidden sm:inline">{themeOptions.find((option) => option.value === mode)?.label ?? "外观"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold text-slate-500">外观模式</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themeOptions.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem key={option.value} onSelect={() => setMode(option.value)}>
              <Icon data-icon="inline-start" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-slate-500">{option.description}</span>
              </span>
              {mode === option.value ? <CheckIcon className="size-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeMenuItems() {
  const { mode, setMode } = useTheme();

  return (
    <>
      <DropdownMenuLabel className="text-xs font-semibold text-slate-500">外观模式</DropdownMenuLabel>
      {themeOptions.map((option) => {
        const Icon = option.icon;
        return (
          <DropdownMenuItem key={option.value} onSelect={() => setMode(option.value)}>
            <Icon data-icon="inline-start" />
            <span className="min-w-0 flex-1">{option.label}</span>
            {mode === option.value ? <CheckIcon className="size-4" /> : null}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
