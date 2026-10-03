import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, LoaderCircleIcon, Maximize2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type CropRect = { x: number; y: number; width: number; height: number };
export type CropedImageState = {
  original: string;
  originalWidth: number;
  originalHeight: number;
  dataUrl: string;
};

type ImageCropDialogProps = {
  open: boolean;
  title: string;
  dataUrl: string | null;
  aspect: number;
  onCancel: () => void;
  onConfirm: (cropped: CropedImageState) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法读取"));
    image.src = dataUrl;
  });
}

function centerCropRect(originalWidth: number, originalHeight: number, aspect: number): CropRect {
  if (!originalWidth || !originalHeight) return { x: 0, y: 0, width: 0, height: 0 };
  if (originalWidth / originalHeight > aspect) {
    const width = originalWidth;
    const height = Math.round(originalWidth / aspect);
    return { x: 0, y: Math.floor(Math.max(0, (originalHeight - height) / 2)), width, height };
  }
  const width = Math.round(originalHeight * aspect);
  const height = originalHeight;
  return { x: Math.floor(Math.max(0, (originalWidth - width) / 2)), y: 0, width, height };
}

function renderCroppedImage(image: HTMLImageElement, crop: CropRect): string {
  const maxLong = 1280;
  const scale = Math.min(maxLong / Math.max(crop.width, crop.height), 2);
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法生成裁切图");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export function ImageCropDialog({ open, title, dataUrl, aspect, onCancel, onConfirm }: ImageCropDialogProps) {
  const [original, setOriginal] = useState<HTMLImageElement | null>(null);
  const [viewport, setViewport] = useState({ width: 480, height: 480 / aspect });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cropRect = useMemo(() => {
    if (!original || !viewport.width || !viewport.height) return { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: clamp(-offset.x / Math.max(scale, 0.001), 0, Math.max(0, original.naturalWidth - viewport.width / Math.max(scale, 0.001))),
      y: clamp(-offset.y / Math.max(scale, 0.001), 0, Math.max(0, original.naturalHeight - viewport.height / Math.max(scale, 0.001))),
      width: viewport.width / Math.max(scale, 0.001),
      height: viewport.height / Math.max(scale, 0.001),
    };
  }, [original, viewport, offset, scale]);

  const minScale = useCallback(() => {
    if (!original || !viewport.width || !viewport.height) return 1;
    return Math.max(viewport.width / original.naturalWidth, viewport.height / original.naturalHeight);
  }, [original, viewport]);

  useEffect(() => {
    if (!open || !dataUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadImage(dataUrl)
      .then((image) => {
        if (cancelled) return;
        setOriginal(image);
        const rect = centerCropRect(image.naturalWidth, image.naturalHeight, aspect);
        const baseScale = Math.min(viewport.width / rect.width, viewport.height / rect.height);
        setScale(baseScale);
        setOffset({ x: -rect.x * baseScale, y: -rect.y * baseScale });
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "图片无法读取"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, dataUrl, aspect, viewport]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (!open || !original) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(240, Math.min(rect.width, 520));
    const height = width / aspect;
    setViewport((current) => (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height }));
  }, [open, original, aspect]);

  const constrainOffset = useCallback((nextX: number, nextY: number) => {
    if (!original) return { x: 0, y: 0 };
    const maxX = Math.max(0, viewport.width - original.naturalWidth * scale);
    const maxY = Math.max(0, viewport.height - original.naturalHeight * scale);
    return { x: clamp(nextX, maxX, 0), y: clamp(nextY, maxY, 0) };
  }, [original, scale, viewport]);

  if (!open) return null;

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!dataUrl) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: offset.x, offsetY: offset.y };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    setOffset(constrainOffset(dragRef.current.offsetX + dx, dragRef.current.offsetY + dy));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function reset() {
    if (!original) return;
    const rect = centerCropRect(original.naturalWidth, original.naturalHeight, aspect);
    const baseScale = Math.min(viewport.width / rect.width, viewport.height / rect.height);
    setScale(baseScale);
    setOffset({ x: -rect.x * baseScale, y: -rect.y * baseScale });
  }

  function changeScale(value: number) {
    if (!original) return;
    const nextScale = clamp(value, minScale(), 5);
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;
    const naturalX = (-offset.x + centerX) / Math.max(scale, 0.001);
    const naturalY = (-offset.y + centerY) / Math.max(scale, 0.001);
    setOffset(constrainOffset(-(naturalX * nextScale - centerX), -(naturalY * nextScale - centerY)));
    setScale(nextScale);
  }

  function confirm() {
    if (!original) return;
    try {
      const cropped = renderCroppedImage(original, cropRect);
      onConfirm({ original: dataUrl!, originalWidth: original.naturalWidth, originalHeight: original.naturalHeight, dataUrl: cropped });
    } catch {
      setError("裁切失败，请重试");
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[min(640px,calc(100vw-32px))] rounded-xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><ImageIcon className="size-4" />{title}裁切</h3>
          <button type="button" onClick={onCancel} className="rounded-full p-1 text-slate-500 hover:bg-slate-100" aria-label="关闭"><XIcon className="size-4" /></button>
        </div>

        {loading || !original || error ? (
          <div className="grid min-h-[240px] place-items-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
            {error ? error : <span className="flex items-center gap-2"><LoaderCircleIcon className="size-4 animate-spin" />正在读取图片…</span>}
          </div>
        ) : (
          <div className="space-y-3">
            <div ref={viewportRef} className="relative mx-auto w-full max-w-[520px] cursor-grab touch-none overflow-hidden rounded-lg bg-slate-900 active:cursor-grabbing" style={{ aspectRatio: `${aspect}` }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
              <img
                src={dataUrl ?? ""}
                alt=""
                draggable={false}
                className="absolute left-0 top-0 max-w-none select-none"
                style={{ width: original.naturalWidth * scale, height: original.naturalHeight * scale, transform: `translate(${offset.x}px, ${offset.y}px)` }}
              />
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, index) => <span key={index} className="border border-white/25" />)}
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/50" />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-600">缩放</span>
              <input type="range" min={minScale()} max={5} step={0.01} value={scale} onChange={(event) => changeScale(Number(event.target.value))} className="min-w-0 flex-1" />
              <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"><RotateCcwIcon className="size-3.5" />居中</button>
            </div>
            <p className="text-[11px] text-slate-500">拖动图片调整展示区域，拖动滑杆放大缩小。确认后会保存裁切后的展示图，原图仍可在页面中点击放大查看。</p>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={confirm} disabled={loading || !original || Boolean(error)}>确认裁切</Button>
        </div>
      </div>
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
      <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={onClose} aria-label="关闭"><XIcon className="size-5" /></button>
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
      <span className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950/0 text-white opacity-0 transition group-hover:bg-slate-950/30 group-hover:opacity-100"><Maximize2Icon className="size-5" /></span>
    </button>
  );
}
