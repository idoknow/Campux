import DefaultTheme from "vitepress/theme";
import Mermaid from "./Mermaid.vue";
import "./style.css";

/**
 * 正文图片点击放大（轻量灯箱）：点击文档内容中的图片弹出全屏遮罩放大查看，
 * 再次点击遮罩或按 Esc 关闭。文案为 DOM 委托，SPA 路由切换无需重新绑定。
 */
function registerImageLightbox() {
  let overlay: HTMLElement | null = null;

  const close = () => {
    overlay?.remove();
    overlay = null;
    document.removeEventListener("keydown", onKeyDown);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const img = target?.closest?.(".VPDoc img") as HTMLImageElement | null;
    if (!img || !img.currentSrc) return;
    event.preventDefault();

    close();
    overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
    const big = document.createElement("img");
    big.src = img.currentSrc;
    big.alt = img.alt || "";
    big.style.cssText =
      "max-width:92vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.55);";
    overlay.append(big);
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);
    document.body.append(overlay);
  });
}

// SSR 安全：仅在浏览器环境注册一次。
if (typeof document !== "undefined") {
  registerImageLightbox();
}

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Mermaid", Mermaid);
  },
};
