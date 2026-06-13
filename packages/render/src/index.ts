import { Buffer } from "node:buffer";
import { chromium, type Browser } from "playwright-core";
import { marked } from "marked";

// 配置 marked：启用 GFM（表格、删除线、自动链接等）
marked.setOptions({
  gfm: true,
  breaks: true, // 尊重换行
});

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
  bgColor?: string;
  textColor?: string;
};

let browserPromise: Promise<Browser> | null = null;

export async function renderPostCard(input: RenderPostCardInput): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
  });

  try {
    await page.setContent(await renderPostHtml(input), {
      waitUntil: "load",
      timeout: 10_000,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    return await page.screenshot({
      type: "jpeg",
      quality: 92,
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
  } finally {
    await page.close();
  }
}

async function getBrowser() {
  browserPromise ??= chromium.launch({
    executablePath: findChromiumExecutable(),
    headless: true,
  });
  return browserPromise;
}

function findChromiumExecutable() {
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined) ||
    "/usr/bin/google-chrome"
  );
}

/**
 * 预处理器：将 `++下划线内容++` 转为 `<u>下划线内容</u>`，
 * marked 原生不支持下划线，用此方式补充。
 */
function preprocessMarkdown(text: string): string {
  return text.replace(/\+\+(.+?)\+\+/g, "<u>$1</u>");
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
  const avatar = input.anonymous ? anonymousAvatarDataUrl() : await qqAvatarDataUrl(input.authorQq);
  const corner = await qqAvatarDataUrl(input.cornerQq ?? process.env.CAMPUX_RENDER_CORNER_QQ);
  const banner = "";

  // 将 Markdown 转为 HTML
  const processedText = preprocessMarkdown(input.text);
  const bodyHtml = await marked.parse(processedText);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    @font-face {
      font-family: "Emoji Fallback";
      src: local("Noto Color Emoji"), local("Apple Color Emoji"), local("Segoe UI Emoji"), local("Twitter Color Emoji"), url("https://fonts.gstatic.com/s/notocoloremoji/v30/Yq6P-KqIXTD0t4D9z1EY1nFp2O3I8aD9xQ.woff2") format("woff2");
      unicode-range: U+1F000-1FFFF, U+200D, U+FE0F, U+2600-27BF, U+2B50, U+2B55, U+2700-27BF, U+2300-23FF, U+2934-2935, U+2B05-2B07, U+2B1B-2B1C, U+3030, U+303D, U+3297, U+3299;
      font-display: swap;
    }

    :root {
      /* emoji 字体置于最前：不含 CJK 字形，遇汉字自动回退到后续 CJK 字体 */
      font-family: "Emoji Fallback", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "EmojiOne Color", "Twemoji Mozilla", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
      --text-color: ${escapeHtml(input.textColor ?? "#000000")};
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: inherit;
      background-color: ${escapeHtml(input.bgColor ?? "#ffffff")};
    }

    #nickname {
      font-weight: bold;
      font-size: 4.5rem;
      line-height: 1.2;
      margin-bottom: 0;
    }

    #words {
      font-family: inherit;
      font-size: 3.3rem;
      display: block;
      width: 65rem;
      margin-top: 4rem;
      color: var(--text-color);
      line-height: 1.6;
      overflow-wrap: break-word;
      word-wrap: break-word;
    }

    /* ── 加粗 ── */
    #words strong {
      font-weight: 900;
    }

    /* ── 斜体 ── */
    #words em {
      font-style: italic;
    }

    /* ── 删除线 ── */
    #words del {
      text-decoration: line-through;
    }

    /* ── 下划线 ── */
    #words u {
      text-decoration: underline;
    }

    /* ── 链接 ── */
    #words a {
      color: #1E88E5;
      text-decoration: underline;
      font-weight: 500;
    }

    /* ── 段落 ── */
    #words p {
      margin-bottom: 1.2rem;
      word-spacing: 0.3rem;
      letter-spacing: 0.3rem;
    }

    /* ── 引用 ── */
    #words blockquote {
      border-left: 6px solid ${escapeHtml(input.textColor ?? "#000000")};
      padding: 0.8rem 1.5rem;
      margin: 1rem 0;
      opacity: 0.85;
      font-style: italic;
    }

    /* ── 无序列表 ── */
    #words ul {
      list-style: disc;
      padding-left: 3rem;
      margin-bottom: 1.2rem;
    }

    #words ul ul {
      list-style: circle;
    }

    #words ul ul ul {
      list-style: square;
    }

    /* ── 有序列表 ── */
    #words ol {
      list-style: decimal;
      padding-left: 3rem;
      margin-bottom: 1.2rem;
    }

    #words li {
      margin-bottom: 0.5rem;
    }

    /* ── 清单勾选 ── */
    #words ul.task-list {
      list-style: none;
      padding-left: 0.5rem;
    }

    #words .task-list-item {
      display: flex;
      align-items: center;
      gap: 0.8rem;
    }

    #words .task-list-item input[type="checkbox"] {
      width: 2.5rem;
      height: 2.5rem;
      flex-shrink: 0;
      accent-color: ${escapeHtml(input.textColor ?? "#000000")};
    }

    /* ── 表格 ── */
    #words table {
      border-collapse: collapse;
      width: 100%;
      margin: 1.5rem 0;
      font-size: 0.9em;
    }

    #words th,
    #words td {
      border: 2px solid var(--text-color);
      padding: 0.8rem 1.2rem;
      text-align: left;
    }

    #words th {
      font-weight: bold;
      opacity: 0.9;
    }

    #words tr:nth-child(even) {
      opacity: 0.85;
    }

    /* ── 代码块 ── */
    #words code {
      font-family: "Fira Code", "Cascadia Code", "JetBrains Mono", monospace;
      font-size: 0.85em;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }

    #words pre {
      margin: 1rem 0;
      padding: 1.2rem;
      border-radius: 6px;
      overflow-x: auto;
    }

    #words pre code {
      padding: 0;
      background: none;
    }

    /* ── 水平分割线 ── */
    #words hr {
      border: none;
      border-top: 2px solid var(--text-color);
      margin: 2rem 0;
      opacity: 0.3;
    }

    img {
      width: 18%;
      height: 18%;
      border-radius: 50%;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
    }

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
<body style="margin: 0">
  <div id="title-bar" style="background-color: #1E88E5; height: 5%; width: calc(100% + 50px); padding: 16px; border-radius: 0 0 8px 8px; font-weight: bold">
    <span style="color: white; font-size: 2.5rem; padding: 1rem;">${escapeHtml(banner)}</span>
  </div>
  <div style="padding: 2.5rem; min-height: 550px; position: relative;">
    <div style="display: flex;">
      <img id="avatar" src="${avatar}" />
      <div style="margin-left: 32px; margin-top: 32px">
        <div id="nickname">${escapeHtml(author)}</div>
        <div id="words">${bodyHtml}</div>
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
