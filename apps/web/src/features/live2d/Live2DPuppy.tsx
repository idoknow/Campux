import { useEffect, useRef } from "react";
import * as PIXI from "pixi.js";

const MODEL_URL = "/live2d/puppy/puppy.model3.json";
const CORE_URL = "/live2d/core/live2dcubismcore.min.js";

type Live2DPuppyProps = {
  className?: string;
  width?: number;
  height?: number;
  zoom?: number;
};

function loadScriptOnce(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === "1") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.loaded = "1";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function waitForSize(target: HTMLElement, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    if (target.clientWidth > 0 && target.clientHeight > 0) {
      resolve(true);
      return;
    }
    const startedAt = Date.now();
    const check = () => {
      if (target.clientWidth > 0 && target.clientHeight > 0) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

export function Live2DPuppy({ className, width = 72, height = 88, zoom = 1 }: Live2DPuppyProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let app: PIXI.Application | null = null;
    let model: InstanceType<typeof import("pixi-live2d-display/cubism4").Live2DModel> | null = null;
    let cleanupModel: (() => void) | null = null;
    let removeTicker: (() => void) | null = null;
    let removePointerMove: (() => void) | null = null;
    let removeListeners: (() => void) | null = null;
    let targetAngleX = 0;
    let targetAngleY = 0;
    let blinkTimer = 0;
    let blinkTarget = 0;
    let glanceTimer = 0;
    let glanceX = 0;
    let glanceY = 0;
    let headTimer = 0;
    let headX = 0;
    let headY = 0;
    let headZ = 0;

    async function init() {
      await loadScriptOnce(CORE_URL);
      if (disposed || !containerRef.current) return;
      const ready = await waitForSize(containerRef.current);
      if (disposed || !containerRef.current || !ready) return;
      const cubism4 = await import("pixi-live2d-display/cubism4");
      const { Live2DModel } = cubism4;
      Live2DModel.registerTicker(PIXI.Ticker);
      if (disposed || !containerRef.current) return;
      app = new PIXI.Application({
        backgroundAlpha: 0,
        width,
        height,
        resizeTo: containerRef.current,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        antialias: false,
        powerPreference: "low-power",
        preserveDrawingBuffer: true,
      });
      const localApp = app;
      const handleContextLost = (event: Event) => {
        event.preventDefault();
      };
      const handleContextRestored = () => {
        localApp.render();
      };
      localApp.view.addEventListener("webglcontextlost", handleContextLost, false);
      localApp.view.addEventListener("webglcontextrestored", handleContextRestored, false);
      const ticker = localApp.ticker;
      const tickerCallback = (deltaMS: number) => {
        const localModel = model;
        if (localModel?.internalModel) {
          const coreModel = localModel.internalModel.coreModel as unknown as {
            setParameterValueById(id: string, value: number, weight?: number): void;
          };
          const focusController = localModel.internalModel.focusController as unknown as {
            targetX: number;
            targetY: number;
            x: number;
            y: number;
            vx: number;
            vy: number;
          };
          const dt = deltaMS / 1000;
          glanceTimer += deltaMS;
          headTimer += deltaMS;
          if (glanceTimer >= 2600 + Math.random() * 2200) {
            glanceTimer = 0;
            glanceX = (Math.random() - 0.5) * 0.5;
            glanceY = (Math.random() - 0.5) * 0.35;
          }
          if (headTimer >= 3600 + Math.random() * 2600) {
            headTimer = 0;
            headX = (Math.random() - 0.5) * 14;
            headY = (Math.random() - 0.5) * 10;
            headZ = (Math.random() - 0.5) * 10;
          }
          glanceX *= 0.975;
          glanceY *= 0.975;
          headX *= 0.955;
          headY *= 0.955;
          headZ *= 0.955;
          focusController.targetX = focusController.x = targetAngleX + glanceX * 0.2;
          focusController.targetY = focusController.y = targetAngleY + glanceY * 0.2;
          focusController.vx = 0;
          focusController.vy = 0;
          const baseAngleX = Math.max(-30, Math.min(30, targetAngleX * 30 + headX * 0.35));
          const baseAngleY = Math.max(-30, Math.min(30, targetAngleY * 30 + headY * 0.3));
          const baseAngleZ = Math.max(-12, Math.min(12, -targetAngleX * targetAngleY * 30 + headZ));
          coreModel.setParameterValueById("ParamAngleX", baseAngleX, 1);
          coreModel.setParameterValueById("ParamAngleY", baseAngleY, 1);
          coreModel.setParameterValueById("ParamAngleZ", baseAngleZ, 1);
          coreModel.setParameterValueById("ParamEyeBallX", targetAngleX + glanceX, 1);
          coreModel.setParameterValueById("ParamEyeBallY", targetAngleY + glanceY, 1);
          coreModel.setParameterValueById("ParamBodyAngleX", baseAngleX * 0.25, 1);
          blinkTimer += deltaMS;
          if (blinkTimer >= 2200 + Math.random() * 1800) {
            blinkTimer = 0;
            blinkTarget = 0.02;
          }
          blinkTarget += (0 - blinkTarget) * Math.min(1, dt * 14);
          coreModel.setParameterValueById("ParamEyeLOpen", blinkTarget, 1);
          coreModel.setParameterValueById("ParamEyeROpen", blinkTarget, 1);
          localModel.internalModel.update(deltaMS, performance.now());
        }
        localApp.render();
      };
      ticker.add(tickerCallback);
      removeTicker = () => ticker.remove(tickerCallback);
      removeListeners = () => {
        localApp.view.removeEventListener("webglcontextlost", handleContextLost, false);
        localApp.view.removeEventListener("webglcontextrestored", handleContextRestored, false);
      };
      removePointerMove = () => {};
      if (disposed) return;
      containerRef.current.appendChild(localApp.view);
      localApp.view.style.pointerEvents = "auto";
      try {
        model = await Live2DModel.from(MODEL_URL, { autoInteract: true, autoUpdate: false });
        if (disposed || !model) return;
        const loadedModel = model;
        const worldHeight = loadedModel.internalModel.height;
        const scale = (height * zoom) / worldHeight;
        loadedModel.scale.set(scale);
        loadedModel.anchor.set(0.5, 0.5);
        loadedModel.x = width / 2;
        loadedModel.y = height / 2;
        const handlePointerMove = (event: PointerEvent) => {
          const dx = event.clientX - window.innerWidth / 2;
          const dy = event.clientY - window.innerHeight / 2;
          const scale = Math.max(window.innerWidth, window.innerHeight) / 2;
          const nx = Math.max(-1, Math.min(1, dx / scale));
          const ny = Math.max(-1, Math.min(1, dy / scale));
          targetAngleX = nx;
          targetAngleY = -ny;
          const focusController = model?.internalModel.focusController as unknown as {
            targetX: number;
            targetY: number;
            x: number;
            y: number;
            vx: number;
            vy: number;
          };
          if (focusController) {
            focusController.targetX = focusController.x = nx;
            focusController.targetY = focusController.y = -ny;
            focusController.vx = 0;
            focusController.vy = 0;
          }
        };
        window.addEventListener("pointermove", handlePointerMove, false);
        removePointerMove = () => {
          window.removeEventListener("pointermove", handlePointerMove, false);
        };
        loadedModel.on("pointertap", () => {
          const exprManager = loadedModel.internalModel.motionManager.expressionManager;
          exprManager?.setRandomExpression();
        });
        localApp.stage.addChild(loadedModel);
        cleanupModel = () => loadedModel.destroy();
      } catch (error) {
        console.error("[Live2DPuppy] failed to load puppy model", error);
      }
    }

    void init().catch((error) => console.error("[Live2DPuppy] failed to initialize", error));

    return () => {
      disposed = true;
      cleanupModel?.();
      removeTicker?.();
      removePointerMove?.();
      removeListeners?.();
      if (app) {
        app.destroy(true, { children: true, texture: false, baseTexture: false });
        app = null;
      }
      cleanupModel = null;
      removeTicker = null;
      removePointerMove = null;
      removeListeners = null;
    };
  }, [height, width, zoom]);

  return <div ref={containerRef} className={className} style={{ width, height, pointerEvents: "none" }} />;
}
