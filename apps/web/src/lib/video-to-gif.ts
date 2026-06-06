import GIF from "gif.js";
import gifWorkerUrl from "gif.js/dist/gif.worker.js?url";

export const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_VIDEO_DURATION_SEC = 60;

export class VideoConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoConversionError";
  }
}

/**
 * Get video metadata (duration) from a File using the browser's <video> element.
 * Returns duration in seconds.
 */
function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        cleanup();
        reject(new VideoConversionError("无法获取视频时长"));
        return;
      }
      cleanup();
      resolve(duration);
    };

    video.onerror = () => {
      cleanup();
      reject(new VideoConversionError("无法加载视频文件"));
    };

    video.src = url;
    video.load();
  });
}

/**
 * Capture a single frame from a video element at the given time and
 * draw it onto a canvas. Returns the canvas.
 */
function captureFrame(
  video: HTMLVideoElement,
  time: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  video.currentTime = time;
  // Seek synchronously — the video is already loaded into memory
  // so seeking is near-instant.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}

/**
 * Detect the native framerate of a video by playing a short segment
 * and counting frames via requestVideoFrameCallback API.
 * Falls back to 30fps if detection is unavailable.
 */
function detectFrameRate(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback !== "function") {
      resolve(30);
      return;
    }

    let frameCount = 0;
    const startTime = performance.now();
    const DETECTION_DURATION = 1000; // 1 second

    const callback = (_now: DOMHighResTimeStamp, _metadata: unknown) => {
      frameCount++;
      const elapsed = performance.now() - startTime;
      if (elapsed >= DETECTION_DURATION) {
        video.pause();
        video.currentTime = 0;
        const fps = Math.round(frameCount / (elapsed / 1000));
        resolve(Math.max(1, Math.min(fps, 120))); // cap at 120fps sanity
      } else {
        video.requestVideoFrameCallback(callback);
      }
    };

    video.requestVideoFrameCallback(callback);
    video.play().catch(() => resolve(30));
  });
}

/**
 * Convert a video File to a GIF Blob entirely in the browser.
 *
 * Uses the video's native framerate and original resolution for
 * maximum quality (every frame, original dimensions).
 *
 * Steps:
 * 1. Validate duration (≤ MAX_VIDEO_DURATION_SEC).
 * 2. Load video into a <video> element to get dimensions.
 * 3. Detect native framerate via requestVideoFrameCallback.
 * 4. Seek through video at native frame intervals, capture each frame to canvas.
 * 5. Encode frames into GIF using gif.js with best quality settings.
 * 6. Return the resulting Blob.
 *
 * @param file - The video File to convert.
 * @param onProgress - Optional callback receiving 0-100 progress.
 * @returns A Promise resolving to the GIF Blob.
 */
export async function convertVideoToGif(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  // 1. Validate size
  if (file.size > MAX_VIDEO_SIZE) {
    throw new VideoConversionError(`视频超过 ${MAX_VIDEO_SIZE / 1024 / 1024}MB 限制`);
  }

  // 2. Get duration
  const duration = await getVideoDuration(file);
  if (duration > MAX_VIDEO_DURATION_SEC) {
    throw new VideoConversionError(
      `视频时长 ${Math.round(duration)}s 超过限制 (${MAX_VIDEO_DURATION_SEC}s)`,
    );
  }
  if (duration <= 0) {
    throw new VideoConversionError("无法获取视频时长");
  }

  // 3. Load video in a hidden element to get dimensions
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";

  const videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new VideoConversionError("无法解码视频"));
    video.load();
  });

  // Use original video dimensions (原画质 — no downscaling)
  const width = video.videoWidth || 320;
  const height = video.videoHeight || 240;

  // 4. Detect native framerate
  const fps = await detectFrameRate(video);

  // 5. Calculate frames at native fps (每一帧都转)
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const frameInterval = duration / totalFrames;

  // 6. Encode with gif.js at best quality settings
  const gif = new GIF({
    workers: 2,
    quality: 1, // lowest sample rate = best quality
    width,
    height,
    repeat: 0, // loop forever
    workerScript: gifWorkerUrl,
    dither: true, // enable dithering for smoother color transitions
  });

  gif.on("progress", (p: number) => {
    onProgress?.(Math.round(p * 100));
  });

  return new Promise<Blob>((resolve, reject) => {
    gif.on("finished", (blob: Blob) => {
      URL.revokeObjectURL(videoUrl);
      video.remove();
      resolve(blob);
    });

    gif.on("abort", () => {
      URL.revokeObjectURL(videoUrl);
      video.remove();
      reject(new VideoConversionError("GIF 编码被中断"));
    });

    // Capture frames at native framerate
    for (let i = 0; i < totalFrames; i++) {
      const time = i * frameInterval;
      const canvas = captureFrame(video, time, width, height);
      gif.addFrame(canvas, {
        delay: Math.round(1000 / fps),
        copy: true,
        dispose: 1,
      });
    }

    gif.render();
  });
}
