import { useEffect, useState } from 'react';
import { ArrowUpRight, Cloud, Github, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LINKS } from '@/lib/campux';
import type { ThemeMode } from '@/hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

/** 全部导航链接；收起态仅显示前 4 项锚点链接，隐藏「文档站 / GitHub」 */
const NAV_LINKS = [
  { label: '功能', href: '#features' },
  { label: '界面', href: '#showcase' },
  { label: '文档', href: '#docs' },
  { label: '社区', href: '#community' },
  { label: '文档站', href: LINKS.docsSite, external: true },
  { label: 'GitHub', href: LINKS.github, external: true },
];

/** 移动端抽屉菜单链接（含外部链接与操作按钮） */
const MOBILE_LINKS = [
  ...NAV_LINKS,
  { label: '登录控制台', href: LINKS.cloud, external: true },
];

/** 抽屉内容自上而下交错入场：基础延迟与步长（ms） */
const SHEET_ENTER_BASE_MS = 50;
const SHEET_ENTER_STEP_MS = 45;

interface NavbarProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onHomeClick?: () => void;
}

/** 顶部导航：玻璃拟态，下滑超过 40px 收缩为居中悬浮胶囊；移动端抽屉菜单 */
export function Navbar({ theme, onToggleTheme, onHomeClick }: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-out',
          scrolled ? 'pt-2.5' : 'pt-4 md:pt-6'
        )}
      >
        <div
          className={cn(
            'mx-auto flex items-center gap-3 border border-transparent bg-transparent px-3 transition-all duration-500 ease-out md:gap-4',
            scrolled
              ? 'max-w-4xl rounded-full border-border/60 bg-background/80 py-1 pl-3.5 pr-2.5 shadow-lg shadow-primary/10 backdrop-blur-xl'
              : 'max-w-6xl rounded-2xl border-border/50 bg-background/60 py-2.5 pl-5 pr-3.5 shadow-card backdrop-blur-xl md:py-3 md:pl-6 md:pr-5'
          )}
        >
          {/* 品牌区 */}
          <a
            href="#top"
            onClick={onHomeClick}
            className="flex shrink-0 items-center gap-2.5"
          >
            <img src="/logo.svg" alt="Campux" className={cn('shrink-0 transition-all duration-500', scrolled ? 'h-5' : 'h-7')} />
            <span
              className={cn(
                'font-heading font-bold tracking-tight text-foreground transition-all duration-500',
                scrolled ? 'text-[13px]' : 'text-base'
              )}
            >
              Camp<span className="text-primary">ux</span>
            </span>
          </a>

          {/* 中间链接：收起态隐藏「文档站 / GitHub」两项 */}
          <nav
            aria-label="主导航"
            className="mx-auto hidden items-center gap-1 lg:flex"
          >
            {NAV_LINKS.map((link, index) => {
              const hiddenWhenCollapsed = index >= 4;
              return (
                <a
                  key={link.label}
                  href={link.href}
                  {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                  className={cn(
                    'flex items-center rounded-full font-medium text-muted-foreground transition-all duration-300 hover:bg-secondary hover:text-primary',
                    scrolled ? 'px-3 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm',
                    hiddenWhenCollapsed &&
                      (scrolled
                        ? 'pointer-events-none w-0 overflow-hidden px-0 opacity-0'
                        : 'pointer-events-auto w-auto opacity-100')
                  )}
                >
                  {link.label}
                </a>
              );
            })}
          </nav>

          {/* 右侧操作区 */}
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            {/* GitHub 图标按钮：仅收起态显示（桌面端） */}
            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub 仓库"
              className={cn(
                'hidden h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-all duration-300 hover:bg-secondary hover:text-primary lg:flex',
                scrolled
                  ? 'scale-100 opacity-100'
                  : 'pointer-events-none scale-75 opacity-0'
              )}
            >
              <Github className="h-3.5 w-3.5" />
            </a>

            <ThemeToggle theme={theme} onToggle={onToggleTheme} compact={scrolled} />

            {/* Cloud 按钮 */}
            <Button
              asChild
              className={cn(
                'hidden rounded-full font-medium shadow-none sm:inline-flex',
                scrolled ? 'h-7 px-3 text-xs' : 'h-9 px-4'
              )}
            >
              <a href={LINKS.cloud} target="_blank" rel="noreferrer">
                <Cloud aria-hidden="true" className="h-4 w-4" />
                Cloud
              </a>
            </Button>

            {/* 移动端汉堡菜单 */}
            <button
              type="button"
              aria-label="打开菜单"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* 移动端抽屉菜单 */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="right"
          className="w-[85vw] max-w-sm gap-0 border-l border-border/60 bg-background/75 p-0 backdrop-blur-2xl"
        >
          <SheetHeader className="animate-sheet-item-in border-b border-border p-5">
            <SheetTitle className="flex items-center gap-2.5 text-left font-heading text-lg font-bold">
              <img src="/logo.svg" alt="Campux" className="h-6 shrink-0" />
              <span>
                Camp<span className="text-primary">ux</span>
              </span>
            </SheetTitle>
            <SheetDescription className="text-left text-xs">
              开源校园墙运营系统
            </SheetDescription>
          </SheetHeader>

          <nav
            aria-label="移动端导航"
            className="flex flex-col gap-1 overflow-y-auto p-4"
          >
            {MOBILE_LINKS.map((link, index) => (
              <a
                key={link.label}
                href={link.href}
                {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                onClick={() => setMenuOpen(false)}
                style={{
                  animationDelay: `${SHEET_ENTER_BASE_MS + index * SHEET_ENTER_STEP_MS}ms`,
                }}
                className="animate-sheet-item-in flex min-h-12 items-center justify-between rounded-xl px-4 text-base font-medium text-foreground transition-colors hover:bg-secondary"
              >
                {link.label}
                {link.external && (
                  <ArrowUpRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                )}
              </a>
            ))}
          </nav>

          <div
            style={{
              animationDelay: `${
                SHEET_ENTER_BASE_MS + MOBILE_LINKS.length * SHEET_ENTER_STEP_MS + 40
              }ms`,
            }}
            className="animate-sheet-item-in mt-auto flex items-center justify-between gap-3 border-t border-border p-5"
          >
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <Button asChild className="flex-1 rounded-full font-medium">
              <a href={LINKS.cloud} target="_blank" rel="noreferrer">
                <Cloud aria-hidden="true" className="h-4 w-4" />
                Cloud
              </a>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
