import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { marked, Tokens } from "marked";

// ── 颜色映射 ──────────────────────────────────────────
// CampuxNext 前端用语义名称传 bgColor/textColor，这里转成实际 CSS 值。

const BG_COLOR_MAP: Record<string, string> = {
  white:  "#FFFFFF",
  pink:   "linear-gradient(135deg, #fef6f8 0%, #fdeef2 50%, #fce6ec 100%)",
  blue:   "linear-gradient(135deg, #f6fafe 0%, #eef6fd 50%, #e6f2fc 100%)",
  green:  "linear-gradient(135deg, #f6faf6 0%, #eef6ee 50%, #e6f2e6 100%)",
  yellow: "linear-gradient(135deg, #fefcf5 0%, #fdfaed 50%, #fcf8e5 100%)",
  orange: "linear-gradient(135deg, #fef9f5 0%, #fdf4ed 50%, #fcefe5 100%)",
  purple: "linear-gradient(135deg, #f9f6fe 0%, #f3eefd 50%, #ede6fc 100%)",
};

const TEXT_COLOR_MAP: Record<string, string> = {
  black:       "#1a1a1a",
  dark_red:    "#8B0000",
  dark_blue:   "#00008B",
  dark_green:  "#006400",
  dark_pink:   "#C71585",
  dark_purple: "#4B0082",
  dark_orange: "#CC5500",
};

function resolveBgColor(raw: string | null | undefined): string {
  if (!raw) return "#FFFFFF";
  return BG_COLOR_MAP[raw] ?? raw;
}

function resolveTextColor(raw: string | null | undefined): string {
  if (!raw) return "#1a1a1a";
  return TEXT_COLOR_MAP[raw] ?? raw;
}

// 自定义 marked 扩展：++下划线++
const underlineExtension = {
  extensions: [
    {
      name: "underline",
      level: "inline" as const,
      start(src: string) {
        return src.indexOf("++");
      },
      tokenizer(this: unknown, src: string): Tokens.Generic | undefined {
        const match = src.match(/^\+\+(.+?)\+\+/);
        if (!match) return;
        return {
          type: "underline",
          raw: match[0],
          text: match[1]?.trim() ?? "",
        };
      },
      renderer(token: Tokens.Generic) {
        return `<u>${token.text}</u>`;
      },
    },
  ],
};

marked.use(underlineExtension);

// ── 字体 base64 内联（Playwright 无 HTTP 服务，URL 无法解析） ──────────
const FONT_FILES: Record<string, string> = {
  beinidekeaitianyunle: "beinidekeaitianyunle.ttf",
  dunhuangfeitiankai: "dunhuangfeitiankai.ttf",
  mengxiangchaoyanningti: "mengxiangchaoyanningti.ttf",
  unifontdianzhenhei: "unifontdianzhenhei.ttf",
  zhuoteqingyati: "zhuoteqingyati.ttf",
  zihuisongkexietiw4: "zihuisongkexietiw4.ttf",
};

let cachedFontCss: string | null = null;

/**
 * 定位 font/ 目录。
 *
 * 运行时 CWD 不固定（`bun --cwd apps/server` 等），所以不能用 process.cwd()。
 * 用 import.meta.dirname（本文件所在目录）向上找到项目根再拼接 font。
 *   本文件: packages/render/src/index.ts
 *   → 项目根: packages/render/src/../../..
 *   → font:   <项目根>/font
 */
function resolveFontDir(): string {
  // import.meta.dirname 是 Bun/Node 提供的当前模块目录绝对路径
  const renderDir = import.meta.dirname!;
  const projectRoot = path.resolve(renderDir, "..", "..", "..");
  return path.join(projectRoot, "font");
}

function getFontCss(): string {
  if (cachedFontCss) return cachedFontCss;

  const fontDir = resolveFontDir();
  const rules: string[] = [];

  for (const [name, fileName] of Object.entries(FONT_FILES)) {
    const filePath = path.join(fontDir, fileName);
    try {
      const buffer = readFileSync(filePath);
      const b64 = buffer.toString("base64");
      rules.push(`@font-face { font-family: "${name}"; src: url("data:font/ttf;base64,${b64}") format("truetype"); }`);
    } catch {
      // 字体文件不可用时跳过，回退系统字体
    }
  }

  cachedFontCss = rules.join("\n");
  return cachedFontCss;
}

export type RenderPostCardInput = {
  tenantName: string;
  authorName: string;
  authorQq?: string;
  cornerQq?: string | undefined;
  displayHost?: string | null | undefined;
  displayId?: number | undefined;
  text: string;
  createdAt: Date;
  anonymous: boolean;
  /** Base64 data URL of the selected anonymous SVG avatar, or undefined to use the default anonymous avatar. */
  anonymousAvatar: string | null | undefined;
  bgColor?: string | null;
  textColor?: string | null;
  font?: string | null;
};

let browserPromise: Promise<Browser> | null = null;

/** 单次卡片渲染的硬超时（含 newPage + setContent + 字体 + screenshot 全过程）。 */
const RENDER_TOTAL_TIMEOUT_MS = 30_000;

export class RenderTimeoutError extends Error {
  constructor(ms: number) {
    super(`渲染卡片超时（>${ms}ms）`);
    this.name = "RenderTimeoutError";
  }
}

/**
 * 给一个 Promise 套一层硬超时。超时后 reject（RenderTimeoutError），
 * 但被包裹的底层操作仍可能在后台继续——调用方负责丢弃/重建相关资源。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * 渲染稿件卡片为 JPEG。
 *
 * 稳定性保证（核心发布链路依赖此函数，绝不允许它无限挂起拖垮单 worker 队列）：
 * - 整个渲染过程（newPage→setContent→字体→screenshot）受 RENDER_TOTAL_TIMEOUT_MS 硬超时约束；
 * - 任何超时或异常都会强制销毁当前共享 browser 并重置 browserPromise，
 *   使下一次调用重建一个干净的 chromium 实例（自愈），避免缓存的僵死实例导致后续 newPage 永久阻塞。
 */
export async function renderPostCard(input: RenderPostCardInput): Promise<Uint8Array> {
  try {
    return await withTimeout(renderPostCardInner(input), RENDER_TOTAL_TIMEOUT_MS);
  } catch (error) {
    // 渲染失败/超时：销毁可能已僵死的 browser，下次 getBrowser() 会重建。
    await resetBrowser();
    throw error;
  }
}

async function renderPostCardInner(input: RenderPostCardInput): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
  });

  try {
    const font = input.font && input.font !== "default" ? input.font : null;
    const fontCss = font ? getFontCss() : "";

    await page.setContent(await renderPostHtml(input), {
      waitUntil: "load",
      timeout: 10_000,
    });

    // 通过 addStyleTag 注入 @font-face（base64 data URI），避免 data: URL 长度限制
    // 注意：不能用 page.evaluate 传大字符串（CDP 序列化可能超时），
    //       addStyleTag 走的是页面内部路径，不会被序列化限制。
    if (fontCss) {
      await page.addStyleTag({ content: fontCss });

      // 等待自定义字体加载并 rasterize
      await page.waitForFunction(() => document.fonts.status === "loaded", undefined, { timeout: 15_000 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    return await page.screenshot({
      type: "jpeg",
      quality: 92,
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
  } finally {
    // page.close 本身也可能在僵死实例上挂起，给它一个短超时兜底，绝不阻塞外层。
    await withTimeout(page.close(), 5_000).catch(() => undefined);
  }
}

async function getBrowser() {
  browserPromise ??= chromium.launch({
    executablePath: findChromiumExecutable(),
    headless: true,
  });
  return browserPromise;
}

/** 销毁当前共享 browser 并清空缓存，使下次 getBrowser() 重建一个干净实例。 */
async function resetBrowser() {
  const current = browserPromise;
  browserPromise = null;
  if (!current) {
    return;
  }
  try {
    const browser = await withTimeout(current, 3_000);
    await withTimeout(browser.close(), 5_000).catch(() => undefined);
  } catch {
    // launch 本身就失败/超时 —— 已清空缓存即可，无需额外处理。
  }
}

function findChromiumExecutable() {
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) ||
    "/usr/bin/google-chrome"
  );
}

async function renderPostHtml(input: RenderPostCardInput) {
  const createdAt = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input.createdAt);
  const author = input.anonymous ? "匿名" : input.authorName || input.authorQq || "用户";
  const footer = input.anonymous ? `匿名用户 发表于 ${createdAt}` : `${input.authorQq ?? input.authorName} 发表于 ${createdAt}`;
  const postIdTag = typeof input.displayId === "number" ? `#${input.displayId}` : "";
  const displayHost = normalizeDisplayHost(input.displayHost);
  const avatar = input.anonymous
    ? (input.anonymousAvatar ?? anonymousAvatarDataUrl())
    : await qqAvatarDataUrl(input.authorQq);
  const corner = await qqAvatarDataUrl(input.cornerQq ?? process.env.CAMPUX_RENDER_CORNER_QQ);
  const banner = "";
  const bgColor = resolveBgColor(input.bgColor);
  const textColor = resolveTextColor(input.textColor);
  const font = input.font && input.font !== "default" ? input.font : null;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    :root {
      font-family: ${font ? `"${font}", ` : ""}"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
    }

    body {
      font-family: inherit;
    }

    #nickname {
      font-family: inherit;
      font-weight: bold;
      font-size: 4.5rem;
      line-height: 1.2;
      margin-bottom: 0;
    }

    #content {
      font-family: inherit;
      font-size: 3.3rem;
      width: 65rem;
      margin-top: 4rem;
      word-spacing: 0.3rem;
      letter-spacing: 0.3rem;
      overflow-wrap: break-word;
      word-wrap: break-word;
      line-height: 1.6;
    }

    #content * {
      color: inherit;
    }

    #content p {
      margin: 0 0 1.2rem;
      white-space: pre-wrap;
    }

    #content p:last-child {
      margin-bottom: 0;
    }

    #content strong {
      font-weight: 700;
    }

    #content em {
      font-style: italic;
    }

    #content s,
    #content del {
      text-decoration: line-through;
    }

    #content u,
    #content ins {
      text-decoration: underline;
    }

    #content blockquote {
      margin: 0 0 1.2rem;
      padding: 0.8rem 1.5rem;
      border-left: 6px solid #1E88E5;
      background: #f0f7ff;
      border-radius: 4px;
      color: #333;
    }

    #content blockquote p {
      margin: 0;
      white-space: normal;
    }

    #content ul,
    #content ol {
      margin: 0 0 1.2rem;
      padding-left: 2.5rem;
    }

    #content li {
      margin-bottom: 0.4rem;
    }

    #content ul ul,
    #content ol ol,
    #content ul ol,
    #content ol ul {
      margin-bottom: 0;
    }

    #content table {
      border-collapse: collapse;
      margin: 0 0 1.2rem;
      width: 100%;
      font-size: 0.85em;
    }

    #content th,
    #content td {
      border: 2px solid #c0c4c8;
      padding: 0.6rem 1rem;
      text-align: left;
    }

    #content th {
      background: #e8f2fd;
      font-weight: 600;
    }

    #content tr:nth-child(even) td {
      background: #f8fafc;
    }

    #content input[type="checkbox"] {
      width: 1.2em;
      height: 1.2em;
      margin-right: 0.6em;
      accent-color: #16a34a;
      transform: translateY(0.1em);
    }

    #content a {
      color: #1E88E5;
      text-decoration: underline;
      word-break: break-all;
    }

    #content hr {
      border: none;
      border-top: 2px solid #d0d4d8;
      margin: 1.2rem 0;
    }

    #content code {
      font-family: "Cascadia Code", "Fira Code", "JetBrains Mono", ui-monospace, monospace;
      background: #f1f5f9;
      padding: 0.1em 0.4em;
      border-radius: 4px;
      font-size: 0.85em;
    }

    #content pre {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 1rem;
      margin: 0 0 1.2rem;
      overflow-x: auto;
    }

    #content pre code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: 0.8em;
    }

    #content h1,
    #content h2,
    #content h3,
    #content h4,
    #content h5,
    #content h6 {
      margin: 1.4rem 0 0.8rem;
      font-weight: 700;
      line-height: 1.3;
    }

    #content h1 { font-size: 1.3em; }
    #content h2 { font-size: 1.2em; }
    #content h3 { font-size: 1.1em; }
    #content h4 { font-size: 1.05em; }

    #footer {
      display: flex;
      justify-content: space-between;
      width: 100%;
      padding: 0px 2rem;
      font-size: 2.2rem;
      margin: 1rem;
      color: #666
    }

    #post-id-tag {
      flex: none;
      font-weight: bold;
      color: #1E88E5;
      background: #E8F2FD;
      padding: 0.2rem 1.1rem;
      border-radius: 999px;
      letter-spacing: 0.05rem;
    }

    #bg-fixed-br {
      position: fixed;
      top: -120px;
      right: -170px;
      width: 500px;
      height: 500px;
      opacity: 0.25;
    }
  </style>
</head>
<body style="margin: 0; background: ${bgColor};">
  <div id="title-bar" style="background-color: #1E88E5; height: 5%; width: calc(100% + 50px); padding: 16px; border-radius: 0 0 8px 8px; font-weight: bold">
    <span style="color: white; font-size: 2.5rem; padding: 1rem;">${escapeHtml(banner)}</span>
  </div>
  <div style="padding: 2.5rem; min-height: 550px; position: relative;">
    <div style="display: flex; align-items: flex-start;">
      <img id="avatar" src="${avatar}" style="flex-shrink: 0; width: 18%; height: 18%; border-radius: 50%; box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);" />
      <div style="margin-left: 32px; margin-top: 32px; flex: 1; min-width: 0;">
        <span id="nickname" style="color: ${textColor};">${escapeHtml(author)}</span>
        <div id="content" style="color: ${textColor};">${renderMarkdown(input.text)}</div>
      </div>
    </div>
  </div>
  <div id="footer">
    <span style="display: flex; align-items: center; gap: 1.2rem;">
      ${postIdTag ? `<span id="post-id-tag">${escapeHtml(postIdTag)}</span>` : ""}
      <span>${escapeHtml(footer)}</span>
    </span>
    <span>${escapeHtml(displayHost)}</span>
  </div>
  <img id="bg-fixed-br" src="${corner}">
</body>
<script type="text/javascript">
  if (document.getElementById('title-bar').innerText.trim() === '') {
    document.getElementById('title-bar').style.display = 'none';
  }
</script>
</html>`;
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { gfm: true, breaks: true }) as string;
}

function normalizeDisplayHost(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "https://campux.top";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function qqAvatarDataUrl(qq: string | undefined) {
  if (!qq || !/^\d+$/.test(qq)) {
    return anonymousAvatarDataUrl();
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(`https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return anonymousAvatarDataUrl();
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return anonymousAvatarDataUrl();
  }
}

function anonymousAvatarDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" rx="128" fill="#e0f2fe"/>
    <circle cx="128" cy="96" r="42" fill="#38bdf8"/>
    <path d="M54 218c10-48 42-76 74-76s64 28 74 76" fill="#0ea5e9"/>
    <path d="M84 88c18-36 70-36 88 0 18 34 0 76-44 76S66 122 84 88Z" fill="#f8fafc" opacity=".92"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
