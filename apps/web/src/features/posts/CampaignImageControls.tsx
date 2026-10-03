import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Maximize2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type CropRect = { x: number; y: number; width: number; height: number };

function cropRect(x: number, y: number, width: number, height: number): CropRect {
  return { x: Math.max(0, Math.min(x, Math.max(0, width - 100))), y: Math.max(0, Math.min(y, Math.max(0, height - 100))), width, height };
}

export function ImageCropField({
  label,
  original,
  originalWidth,
  originalHeight,
  crop,
  aspect,
  width,
  height,
  onChange,
  onPick,
  onRemove,
}: {
  label: string;
  original: string | null;
  originalWidth: number;
  originalHeight: number;
  crop: CropRect;
  aspect: number;
  width: number;
  height: number;
  onChange: (crop: CropRect) => void;
  onPick: () => void;
  onRemove: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cropBoxRef = useRef<HTMLDivElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; cropX: number; cropY: number } | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const box = cropBoxRef.current;
    if (!viewport || !box) return;
    if (Number.isFinite(crop.x) && Number.isFinite(crop.y)) {
      box.style.left = `${(crop.x / Math.max(1, originalWidth)) * 100}%`;
      box.style.top = `${(crop.y / Math.max(1, originalHeight)) * 100}%`;
      box.style.width = `${(crop.width / Math.max(1, originalWidth)) * 100}%`;
      box.style.height = `${(crop.height / Math.max(1, originalHeight)) * 100}%`;
    }
    const image = cropImageRef.current;
    if (!image) return;
    const viewportW = viewport.clientWidth || 360;
    const viewportH = viewport.clientHeight || (viewportW / aspect) || 225;
    const scale = Math.max(viewportW / crop.width, viewportH / crop.height);
    const scaledW = crop.width * scale;
    const scaledH = crop.height * scale;
    image.style.width = `${scaledW}px`;
    image.style.height = `${scaledH}px`;
    image.style.left = `${-crop.x * scale}px`;
    image.style.top = `${-crop.y * scale}px`;
  }, [original, originalWidth, originalHeight, crop, aspect]);

  const updateCropFromClient = useCallback((clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    const box = cropBoxRef.current;
    if (!viewport || !box) return;
    const boxRect = box.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const rect = cropRect(clientX - viewportRect.left - crop.width / 2, clientY - viewportRect.top - crop.height / 2, originalWidth, originalHeight);
    box.style.left = `${(rect.x / Math.max(1, originalWidth)) * 100}%`;
    box.style.top = `${(rect.y / Math.max(1, originalHeight)) * 100}%`;
    box.style.width = `${(rect.width / Math.max(1, originalWidth)) * 100}%`;
    box.style.height = `${(rect.height / Math.max(1, originalHeight)) * 100}%`;
    const image = cropImageRef.current;
    if (image) {
      const viewportW = viewport.clientWidth || 360;
      const viewportH = viewport.clientHeight || (viewportW / aspect) || 225;
      const scale = Math.max(viewportW / rect.width, viewportH / rect.height);
      image.style.width = `${rect.width * scale}px`;
      image.style.height = `${rect.height * scale}px`;
      image.style.left = `${-rect.x * scale}px`;
      image.style.top = `${-rect.y * scale}px`;
    }
    onChange(rect);
  }, [aspect, onChange, originalHeight, originalWidth, crop.width, crop.height]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!original) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const boxRect = event.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: event.clientX, startY: event.clientY, cropX: crop.x, cropY: crop.y };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    event.preventDefault();
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    const viewport = viewportRef.current;
    const box = cropBoxRef.current;
    if (!viewport || !box) return;
    const boxRect = box.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const naturalX = dragRef.current.cropX + (dx / boxRect.width) * originalWidth;
    const naturalY = dragRef.current.cropY + (dy / boxRect.height) * originalHeight;
    const rect = cropRect(naturalX, naturalY, crop.width, crop.height);
    updateCropFromClient(viewportRect.left + (rect.x + rect.width / 2) / originalWidth * viewportRect.width, viewportRect.top + (rect.y + rect.height / 2) / originalHeight * viewportRect.height);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && event.target !== cropBoxRef.current) return;
    updateCropFromClient(event.clientX, event.clientY);
  };

  const resetCrop = () => {
    const width = originalWidth;
    const height = Math.round(originalWidth / aspect);
    onChange({ x: 0, y: Math.max(0, Math.floor((originalHeight - height) / 2)), width, height });
  };

  return (
    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <ImageIcon className="size-3.5" />{label}预览/裁切
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={resetCrop} disabled={!original}><RotateCcwIcon className="size-3.5" />居中</Button>
          <Button size="sm" variant="outline" onClick={onPick}>更换</Button>
          <Button size="sm" variant="ghost" onClick={onRemove} disabled={!original}>移除</Button>
        </div>
      </div>
      {original ? (
        <div ref={viewportRef} className="relative mx-auto w-full max-w-[420px] cursor-move touch-none overflow-hidden rounded-md border border-slate-200 bg-slate-900" style={{ aspectRatio: `${aspect}` }} onPointerDown={onViewportPointerDown}>
          <img ref={cropImageRef} src={original} alt="" className="absolute max-w-none select-none" draggable={false} />
          <div ref={cropBoxRef} className="absolute inset-0 border border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.65)]" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, index) => <span key={index} className="border border-white/20" />)}
          </div>
        </div>
      ) : (
        <button type="button" onClick={onPick} className="grid w-full max-w-[420px] place-items-center rounded-md border border-dashed border-slate-300 bg-white py-8 text-xs text-slate-500">选择图片</button>
      )}
      <p className="text-[11px] text-slate-500">拖动裁切区域，只影响列表/详情里的展示比例；点击上传区可更换图片，原图仍会完整保留。</p>
    </div>
  );
}

export function FullImageLightbox({ src, alt, onClose }: { src: string | null; alt: string; onClose: () => void }) {
  useEffect(() => {
    if (!src) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, src]);

  if (!src) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={onClose} aria-label="关闭">
        <XIcon className="size-5" />
      </button>
      <div className="relative max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
        <img src={src} alt={alt} className="max-h-[88vh] max-w-[92vw] rounded-md object-contain" />
      </div>
    </div>
  );
}

export function ZoomableImage({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`group relative inline-flex overflow-hidden rounded border border-slate-200 bg-slate-100 ${className ?? ""}`} aria-label={`查看${alt}大图`}>
      <img src={src} alt={alt} className="h-full w-full object-cover" />
      <span className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950/0 text-white opacity-0 transition group-hover:bg-slate-950/30 group-hover:opacity-100">
        <Maximize2Icon className="size-5" />
      </span>
    </button>
  );
}
