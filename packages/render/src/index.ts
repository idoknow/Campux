import { Buffer } from "node:buffer";
import { chromium, type Browser } from "playwright-core";

export type RenderPostCardInput = {
  tenantName: string;
  authorName: string;
  authorQq?: string;
  text: string;
  createdAt: Date;
  anonymous: boolean;
};

let browserPromise: Promise<Browser> | null = null;

export async function renderPostCard(input: RenderPostCardInput): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: {
      width: 900,
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
  const corner = await qqAvatarDataUrl(process.env.CAMPUX_RENDER_CORNER_QQ);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #fff; font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    body { width: 900px; color: #061328; }
    .bar { height: 30px; background: #1E88E5; }
    .wrap { position: relative; min-height: 650px; overflow: hidden; padding: 52px 56px 28px; }
    .corner { position: absolute; top: -120px; right: -170px; width: 500px; height: 500px; border-radius: 50%; opacity: .18; object-fit: cover; }
    .head { display: flex; align-items: flex-start; gap: 32px; }
    .avatar { width: 132px; height: 132px; flex: 0 0 auto; border-radius: 50%; object-fit: cover; box-shadow: 0 8px 28px rgba(15, 23, 42, .2); }
    .main { min-width: 0; flex: 1; }
    .name { display: block; font-size: 56px; font-weight: 900; line-height: 1.12; letter-spacing: 0; }
    .text { display: block; width: 100%; margin-top: 44px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 42px; font-weight: 700; line-height: 1.38; letter-spacing: .06em; color: #172033; }
    .footer { display: flex; justify-content: space-between; gap: 24px; padding: 0 56px 28px; color: #64748b; font-size: 24px; font-weight: 700; }
    .footer span { min-width: 0; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <div class="bar"></div>
  <div class="wrap">
    <img class="corner" src="${corner}" />
    <div class="head">
      <img class="avatar" src="${avatar}" />
      <div class="main">
        <span class="name">${escapeHtml(author)}</span>
        <span class="text">${escapeHtml(input.text)}</span>
      </div>
    </div>
  </div>
  <div class="footer">
    <span>${escapeHtml(footer)}</span>
    <span>Campux</span>
  </div>
</body>
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
