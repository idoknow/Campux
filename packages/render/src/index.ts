import { Buffer } from "node:buffer";
import { chromium, type Browser } from "playwright-core";
import { marked, Tokens } from "marked";

// ── 颜色映射 ──────────────────────────────────────────
// CampuxNext 前端用语义名称传 bgColor/textColor，这里转成实际 CSS 值。

const BG_COLOR_MAP: Record<string, string> = {
  white:  "",
  pink:   "linear-gradient(135deg, #fff8f9 0%, #fff0f3 50%, #ffe8ed 100%)",
  blue:   "linear-gradient(135deg, #f5faff 0%, #ebf5ff 50%, #e0f0ff 100%)",
  green:  "linear-gradient(135deg, #f5faf5 0%, #ebf5eb 50%, #e0f0e0 100%)",
  yellow: "linear-gradient(135deg, #fffff5 0%, #fffceb 50%, #fffae0 100%)",
  orange: "linear-gradient(135deg, #fffaf5 0%, #fff5eb 50%, #fff0e0 100%)",
  purple: "linear-gradient(135deg, #faf5ff 0%, #f5ebff 50%, #f0e0ff 100%)",
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
  if (!raw) return "";
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
  bgColor?: string | null;
  textColor?: string | null;
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
  const bgColor = resolveBgColor(input.bgColor);
  const textColor = resolveTextColor(input.textColor);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    :root {
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
    }

    body {
      font-family: inherit;
    }

    #nickname {
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
<body style="margin: 0; background: #FFFFFF;">
  <div id="title-bar" style="background-color: #1E88E5; height: 5%; width: calc(100% + 50px); padding: 16px; border-radius: 0 0 8px 8px; font-weight: bold">
    <span style="color: white; font-size: 2.5rem; padding: 1rem;">${escapeHtml(banner)}</span>
  </div>
  <div style="padding: 2.5rem; min-height: 550px; position: relative;">
    <div style="display: flex; align-items: flex-start;">
      <img id="avatar" src="${avatar}" style="flex-shrink: 0; width: 18%; height: 18%; border-radius: 50%; box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);" />
      <div style="margin-left: 32px; margin-top: 32px; flex: 1; min-width: 0; border-radius: 16px;${bgColor ? ` padding: 20px 28px; background: ${bgColor};` : ""}">
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
