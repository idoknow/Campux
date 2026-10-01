import { Lock, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SmartImage } from './SmartImage';

interface BrowserWindowProps {
  /** 窗口标题（地址栏文字） */
  title: string;
  /** 截图地址 */
  src: string;
  /** 图片替代文字 */
  alt: string;
  /** 内容区宽高比 class，默认 aspect-[16/10] */
  aspectClassName?: string;
  /** 点击截图回调（打开灯箱）；提供时展示悬停查看浮层 */
  onImageClick?: () => void;
  className?: string;
}

/** 浏览器窗口风格的截图容器：交通灯 + 地址栏 + 内容区 + 悬停放大浮层 */
export function BrowserWindow({
  title,
  src,
  alt,
  aspectClassName = 'aspect-[16/10]',
  onImageClick,
  className,
}: BrowserWindowProps) {
  return (
    <div
      className={cn(
        'group overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-shadow duration-300',
        onImageClick && 'cursor-zoom-in hover:shadow-hover',
        className
      )}
    >
      <div className="flex items-center gap-3 border-b border-border/70 bg-muted/70 px-4 py-2.5">
        <div className="flex shrink-0 gap-1.5" aria-hidden="true">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-background px-3 text-xs text-muted-foreground md:max-w-[70%]">
          <Lock aria-hidden="true" className="h-3 w-3 shrink-0 text-mint" />
          <span className="truncate">{title}</span>
        </div>
        <div className="w-[46px] shrink-0" aria-hidden="true" />
      </div>
      <div className={cn('relative w-full overflow-hidden', aspectClassName)}>
        <SmartImage
          src={src}
          alt={alt}
          onClick={onImageClick}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        />
        {/* 悬停查看大图浮层 */}
        {onImageClick && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/25 opacity-0 backdrop-blur-[2px] transition-opacity duration-300 group-hover:opacity-100">
            <span className="flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 text-sm font-medium text-foreground shadow-lg">
              <Maximize2 aria-hidden="true" className="h-4 w-4 text-primary" />
              点击查看大图
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
