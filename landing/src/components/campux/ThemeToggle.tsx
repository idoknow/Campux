import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThemeMode } from '@/hooks/useTheme';

interface ThemeToggleProps {
  theme: ThemeMode;
  onToggle: () => void;
  /** 紧凑模式：供灵动岛等窄容器使用 */
  compact?: boolean;
  className?: string;
}

/** 亮暗主题切换开关：太阳 / 月亮旋钮平滑滑动 */
export function ThemeToggle({ theme, onToggle, compact = false, className }: ThemeToggleProps) {
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
      onClick={onToggle}
      className={cn(
        'relative flex shrink-0 items-center rounded-full border border-border bg-muted px-1 shadow-inner transition-colors duration-300',
        compact ? 'h-7 w-[3.25rem]' : 'h-8 w-[3.75rem]',
        className
      )}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          'absolute left-2.5 text-butter transition-opacity duration-300',
          compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
          isDark ? 'opacity-70' : 'opacity-0'
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'absolute right-2.5 text-lilac transition-opacity duration-300',
          compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
          isDark ? 'opacity-0' : 'opacity-70'
        )}
      />
      <span
        className={cn(
          'relative z-10 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform duration-300 ease-out',
          compact ? 'h-5 w-5' : 'h-6 w-6',
          isDark
            ? compact
              ? 'translate-x-6'
              : 'translate-x-[1.75rem]'
            : 'translate-x-0'
        )}
      >
        {isDark ? (
          <Moon aria-hidden="true" className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        ) : (
          <Sun aria-hidden="true" className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        )}
      </span>
    </button>
  );
}
