declare module "gif.js" {
  interface GIFOptions {
    workers?: number;
    quality?: number;
    width?: number;
    height?: number;
    workerScript?: string;
    background?: string;
    repeat?: number;
    transparent?: string | null;
    dither?: boolean;
    debug?: boolean;
    colorSpace?: string;
  }

  interface AddFrameOptions {
    delay?: number;
    copy?: boolean;
    dispose?: number;
  }

  class GIF {
    constructor(options?: GIFOptions);
    addFrame(element: CanvasImageSource | ImageData | CanvasRenderingContext2D, options?: AddFrameOptions): void;
    on(event: "progress", callback: (progress: number) => void): void;
    on(event: "finished", callback: (blob: Blob) => void): void;
    on(event: "abort", callback: () => void): void;
    render(): void;
    abort(): void;
  }

  export default GIF;
}
