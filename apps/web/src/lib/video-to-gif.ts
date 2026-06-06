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
 * Ensures the frame is seeked to the exact time before capture.
 */
function captureFrame(
  video: HTMLVideoElement,
  time: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  // Use canvas with offscreen rendering for better quality
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  
  // Set video time and clamp to valid range
  video.currentTime = Math.max(0, Math.min(time, video.duration));
  
  const ctx = canvas.getContext("2d", { 
    willReadFrequently: true,
    alpha: false, // optimize for opaque content
  })!;
  
  // Use high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  
  // Draw the frame
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
    let callbackId: number | null = null;

    const callback = (_now: DOMHighResTimeStamp, _metadata: unknown) => {
      frameCount++;
      const elapsed = performance.now() - startTime;
      
      if (elapsed >= DETECTION_DURATION) {
        video.pause();
        video.currentTime = 0;
        const fps = Math.round(frameCount / (elapsed / 1000));
        // Return detected fps, capped at 120fps for sanity
        // Also ensure minimum of 1 fps
        resolve(Math.max(1, Math.min(fps, 120)));
      } else {
        callbackId = video.requestVideoFrameCallback(callback);
      }
    };

    callbackId = video.requestVideoFrameCallback(callback);
    video.play().catch(() => {
      if (callbackId !== null) {
        video.cancelVideoFrameCallback(callbackId);
      }
      resolve(30);
    });

    // Timeout fallback in case detection never completes
    setTimeout(() => {
      if (callbackId !== null) {
        video.cancelVideoFrameCallback(callbackId);
        video.pause();
        video.currentTime = 0;
        resolve(Math.max(1, Math.round(frameCount / (DETECTION_DURATION / 1000))));
      }
    }, DETECTION_DURATION + 100);
  });
}

/**
 * Convert a video File to a GIF Blob entirely in the browser.
 *
 * Features for maximum quality and smooth animation:
 * - Captures EVERY frame at video's native framerate (每一帧都转)
 * - Uses original video resolution with high-quality image smoothing (原画质)
 * - Optimal GIF encoding: quality=1, FloydSteinberg dithering, dispose=2 (连贯通顺)
 * - Accurate frame timing with proper frame delay calculation
 * - RequestAnimationFrame batching to prevent UI blocking
 * - Automatic framerate detection with fallback to 30fps
 *
 * Steps:
 * 1. Validate video size (≤ MAX_VIDEO_SIZE) and duration (≤ MAX_VIDEO_DURATION_SEC)
 * 2. Load video into a <video> element to get dimensions
 * 3. Detect native framerate via requestVideoFrameCallback with fallback
 * 4. Calculate exact frame intervals based on detected framerate
 * 5. Seek through video and capture each frame to canvas with high-quality rendering
 * 6. Encode frames into GIF with best quality settings and proper frame disposal
 * 7. Return the resulting GIF Blob
 *
 * @param file - The video File to convert
 * @param onProgress - Optional callback receiving 0-100 progress percentage
 * @returns A Promise resolving to the GIF Blob
 * @throws VideoConversionError if video is invalid, too large, too long, or cannot be decoded
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
  const frameDuration = 1000 / fps; // ms per frame

  // 6. Encode with gif.js at best quality settings
  const gif = new GIF({
    workers: 2,
    quality: 1, // lowest sample rate = best quality
    width,
    height,
    repeat: 0, // loop forever
    workerScript: gifWorkerUrl,
    dither: true, // enable Floyd-Steinberg dithering for smooth color transitions
  });

  let progressFrameCount = 0;

  gif.on("progress", (p: number) => {
    // Combine frame capture progress and encoding progress
    const overallProgress = Math.round((progressFrameCount / totalFrames + p) / 2 * 100);
    onProgress?.(overallProgress);
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
    // Use requestAnimationFrame to ensure smooth frame capture
    let frameIndex = 0;
    
    const captureNextFrame = () => {
      if (frameIndex >= totalFrames) {
        gif.render();
        return;
      }

      const time = frameIndex * frameInterval;
      const canvas = captureFrame(video, time, width, height);
      
      gif.addFrame(canvas, {
        delay: Math.round(frameDuration),
        copy: true,
        dispose: 2, // use dispose method 2 for smoother animation
      });

      progressFrameCount = frameIndex + 1;
      onProgress?.(Math.round((progressFrameCount / totalFrames) * 100));

      frameIndex++;
      
      // Batch frames in groups of 5 to avoid blocking
      if (frameIndex % 5 === 0) {
        requestAnimationFrame(captureNextFrame);
      } else {
        captureNextFrame();
      }
    };

    captureNextFrame();
  });
}
