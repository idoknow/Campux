import { Buffer } from "node:buffer";
import { chromium, type Browser } from "playwright-core";

export type RenderPostCardInput = {
  tenantName: string;
  authorName: string;
  authorQq?: string;
  cornerQq?: string | undefined;
  text: string;
  createdAt: Date;
  anonymous: boolean;
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
  const avatar = input.anonymous ? anonymousAvatarDataUrl() : await qqAvatarDataUrl(input.authorQq);
  const corner = await qqAvatarDataUrl(input.cornerQq ?? process.env.CAMPUX_RENDER_CORNER_QQ);
  const banner = "";

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

    #words {
      font-family: inherit;
      font-size: 3.3rem;
      display: block;
      width: 65rem;
      margin-top: 4rem;
      word-spacing: 0.3rem;
      letter-spacing: 0.3rem;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-wrap: break-word;
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
  <div style="padding: 2.5rem; min-height: 550px;">
    <div style="display: flex;">
      <img id="avatar" src="${avatar}" />
      <div style="margin-left: 32px; margin-top: 32px">
        <span id="nickname">${escapeHtml(author)}</span>
        <span id="words">${escapeHtml(input.text)}</span>
      </div>
    </div>
  </div>
  <div id="footer">
    <span>${escapeHtml(footer)}</span>
    <span>https://campux.top</span>
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
