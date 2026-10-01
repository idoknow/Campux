import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartImageProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
}

/**
 * 自适应图片：加载失败时优雅降级为占位图标与替代文字，保证布局不塌陷
 */
export function SmartImage({ src, alt, className, onClick }: SmartImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/50 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
          <ImageOff aria-hidden="true" className="h-6 w-6" />
        </div>
        <p className="max-w-[24rem] text-sm leading-relaxed text-muted-foreground">{alt}</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      onClick={onClick}
      className={cn(
        'h-full w-full object-cover transition-opacity duration-500',
        loaded ? 'opacity-100' : 'opacity-0',
        onClick && 'cursor-zoom-in',
        className
      )}
    />
  );
}
