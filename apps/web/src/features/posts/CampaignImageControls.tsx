import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, LoaderCircleIcon, Maximize2Icon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type CropRect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type ViewState = { offset: Point; scale: number };
type ViewStateRef = { current: ViewState };
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

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  const [viewState, setViewState] = useState<ViewState>({ offset: { x: 0, y: 0 }, scale: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewStateRef = useRef<ViewState>({ offset: { x: 0, y: 0 }, scale: 1 });
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<{ mode: "drag" | "pinch"; startX: number; startY: number; startOffset: Point; startDistance: number; startScale: number } | null>(null);

  const minScale = useCallback(() => {
    if (!original || !viewport.width || !viewport.height) return 1;
    return Math.max(viewport.width / original.naturalWidth, viewport.height / original.naturalHeight);
  }, [original, viewport]);

  const applyViewState = useCallback((next: ViewState) => {
    if (!original) return;
    const nextScale = next.scale;
    const scaledWidth = original.naturalWidth * nextScale;
    const scaledHeight = original.naturalHeight * nextScale;
    const clampOne = (value: number, imageLength: number, viewportLength: number) => {
      if (imageLength <= viewportLength) return (viewportLength - imageLength) / 2;
      return clamp(value, viewportLength - imageLength, 0);
    };
    const safe: ViewState = {
      scale: nextScale,
      offset: {
        x: clampOne(next.offset.x, scaledWidth, viewport.width),
        y: clampOne(next.offset.y, scaledHeight, viewport.height),
      },
    };
    viewStateRef.current = safe;
    setViewState(safe);
  }, [original, viewport]);

  const setCenteredView = useCallback(() => {
    if (!original) return;
    const rect = centerCropRect(original.naturalWidth, original.naturalHeight, aspect);
    const baseScale = Math.min(viewport.width / rect.width, viewport.height / rect.height);
    applyViewState({ scale: baseScale, offset: { x: -rect.x * baseScale, y: -rect.y * baseScale } });
  }, [applyViewState, aspect, original, viewport]);

  const zoomAtCenter = useCallback((factor: number) => {
    if (!original) return;
    const current = viewStateRef.current;
    const nextScale = clamp(current.scale * factor, minScale(), 5);
    const ratio = nextScale / current.scale;
    applyViewState({
      scale: nextScale,
      offset: {
        x: viewport.width / 2 - (viewport.width / 2 - current.offset.x) * ratio,
        y: viewport.height / 2 - (viewport.height / 2 - current.offset.y) * ratio,
      },
    });
  }, [applyViewState, minScale, original, viewport]);

  useEffect(() => {
    if (!open || !dataUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadImage(dataUrl)
      .then((image) => {
        if (cancelled) return;
        setOriginal(image);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "图片无法读取"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, dataUrl]);

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
    setViewport((current) => {
      if (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1) return current;
      return { width, height };
    });
  }, [open, original, aspect]);

  useEffect(() => {
    if (original) setCenteredView();
  }, [original, setCenteredView]);

  const cropRect = useMemo(() => {
    if (!original || !viewport.width || !viewport.height) return { x: 0, y: 0, width: 0, height: 0 };
    const scale = Math.max(viewState.scale, 0.001);
    return {
      x: clamp(-viewState.offset.x / scale, 0, Math.max(0, original.naturalWidth - viewport.width / scale)),
      y: clamp(-viewState.offset.y / scale, 0, Math.max(0, original.naturalHeight - viewport.height / scale)),
      width: viewport.width / scale,
      height: viewport.height / scale,
    };
  }, [original, viewport, viewState]);

  const pointInViewport = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY };
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!original) return;
    event.preventDefault();
    zoomAtCenter(Math.exp(-event.deltaY * 0.0015));
  }, [original, zoomAtCenter]);

  const syncPointer = useCallback((point: Point, pointerId: number) => {
    pointersRef.current.set(pointerId, point);
    const points = Array.from(pointersRef.current.values());
    const gesture = gestureRef.current;
    if (gesture?.mode === "pinch" && points.length === 2) {
      const a = points[0];
      const b = points[1];
      if (!a || !b) return;
      const factor = distance(a, b) / Math.max(gesture.startDistance, 1);
      applyViewState({ scale: clamp(gesture.startScale * factor, minScale(), 5), offset: gesture.startOffset });
    }
  }, [applyViewState, minScale]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dataUrl) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointInViewport(event.clientX, event.clientY);
    syncPointer(point, event.pointerId);

    if (pointersRef.current.size === 1) {
      gestureRef.current = { mode: "drag", startX: event.clientX, startY: event.clientY, startOffset: viewStateRef.current.offset, startDistance: 0, startScale: viewStateRef.current.scale };
    } else if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      if (points.length === 2) {
        const a = points[0];
        const b = points[1];
        if (a && b) gestureRef.current = { mode: "pinch", startX: 0, startY: 0, startOffset: viewStateRef.current.offset, startDistance: distance(a, b), startScale: viewStateRef.current.scale };
      }
    }
  }, [dataUrl, pointInViewport, syncPointer]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const point = pointInViewport(event.clientX, event.clientY);
    syncPointer(point, event.pointerId);
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.mode === "drag" && pointersRef.current.size === 1) {
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      applyViewState({ scale: viewStateRef.current.scale, offset: { x: gesture.startOffset.x + dx, y: gesture.startOffset.y + dy } });
    }
  }, [applyViewState, pointInViewport, syncPointer]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2 && gestureRef.current?.mode === "pinch") gestureRef.current = null;
    if (pointersRef.current.size === 1) {
      const point = Array.from(pointersRef.current.values())[0];
      if (point) gestureRef.current = { mode: "drag", startX: point.x, startY: point.y, startOffset: viewStateRef.current.offset, startDistance: 0, startScale: viewStateRef.current.scale };
    } else if (pointersRef.current.size === 0) {
      gestureRef.current = null;
    }
  }, []);

  if (!open) return null;

  function confirm() {
    if (!original) return;
    try {
      const cropped = renderCroppedImage(original, cropRect);
      onConfirm({ original: dataUrl ?? "", originalWidth: original.naturalWidth, originalHeight: original.naturalHeight, dataUrl: cropped });
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
            <div ref={viewportRef} className="relative mx-auto w-full max-w-[520px] cursor-grab touch-none overflow-hidden rounded-lg bg-slate-900 active:cursor-grabbing" style={{ aspectRatio: `${aspect}` }} onWheel={handleWheel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
              <div className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing" />
              <img
                src={dataUrl ?? ""}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
                style={{ width: original.naturalWidth * viewState.scale, height: original.naturalHeight * viewState.scale, transform: `translate(${viewState.offset.x}px, ${viewState.offset.y}px)` }}
              />
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, index) => <span key={index} className="border border-white/25" />)}
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/50" />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-500">拖动图片调整展示区域，滚轮/双指缩放。</p>
              <button type="button" onClick={setCenteredView} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50"><RotateCcwIcon className="size-3.5" />重置</button>
            </div>
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
