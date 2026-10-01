import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SmartImage } from './SmartImage';

interface LightboxProps {
  open: boolean;
  src: string;
  title: string;
  onClose: () => void;
}

/** 全屏截图查看灯箱：按 Esc 或点击遮罩关闭（Dialog 自带支持） */
export function Lightbox({ open, src, title, onClose }: LightboxProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 shadow-2xl md:max-w-5xl"
      >
        <div className="flex items-center border-b border-border bg-muted/70 px-5 py-3">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </DialogTitle>
        </div>
        <div className="max-h-[78dvh] overflow-auto bg-muted/30">
          <SmartImage
            src={src}
            alt={title}
            className="h-auto w-full object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
