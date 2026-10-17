import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResolvedTheme, ThemeMode } from '@/hooks/useTheme';

interface ThemeToggleProps {
  /** 当前主题模式（light / system / dark 三态循环） */
  theme: ThemeMode;
  /** 当前实际生效的亮暗（跟随系统档位用于展示与无障碍提示） */
  resolvedTheme: ResolvedTheme;
  onToggle: () => void;
  /** 紧凑模式：供灵动岛等窄容器使用 */
  compact?: boolean;
  className?: string;
}

const MODE_LABELS: Record<ThemeMode, string> = {
  light: '亮色模式',
  system: '跟随系统',
  dark: '暗色模式',
};

/** 亮暗主题切换开关：太阳 / 显示器 / 月亮三档旋钮平滑滑动 */
export function ThemeToggle({ theme, resolvedTheme, onToggle, compact = false, className }: ThemeToggleProps) {
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme !== 'system'}
      aria-label={`当前：${MODE_LABELS[theme]}${theme === 'system' ? `（${isDark ? '暗色' : '亮色'}）` : ''}，点击切换`}
      title={`当前：${MODE_LABELS[theme]}${theme === 'system' ? `（${isDark ? '暗色' : '亮色'}）` : ''}`}
      onClick={onToggle}
      className={cn(
        'relative flex shrink-0 items-center rounded-full border border-border bg-muted px-1 shadow-inner transition-colors duration-300',
        compact ? 'h-7 w-[4.25rem]' : 'h-8 w-[4.75rem]',
        className
      )}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          'absolute left-2.5 text-butter transition-opacity duration-300',
          compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
          theme === 'light' ? 'opacity-0' : 'opacity-70'
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'absolute right-2.5 text-lilac transition-opacity duration-300',
          compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
          theme === 'dark' ? 'opacity-0' : 'opacity-70'
        )}
      />
      <span
        className={cn(
          'relative z-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform duration-300 ease-out',
          compact ? 'h-5 w-5' : 'h-6 w-6',
          theme === 'system'
            ? compact
              ? 'translate-x-6'
              : 'translate-x-7'
            : theme === 'dark'
              ? compact
                ? 'translate-x-12'
                : 'translate-x-[3.25rem]'
              : 'translate-x-0'
        )}
      >
        {theme === 'system' ? (
          <Monitor aria-hidden="true" className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        ) : theme === 'dark' ? (
          <Moon aria-hidden="true" className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        ) : (
          <Sun aria-hidden="true" className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        )}
      </span>
    </button>
  );
}
