export type RenderPostCardInput = {
  tenantName: string;
  authorName: string;
  text: string;
  createdAt: Date;
  anonymous: boolean;
};

export async function renderPostCard(input: RenderPostCardInput): Promise<Uint8Array> {
  const width = 900;
  const padding = 56;
  const lines = wrapText(input.text, 28).slice(0, 16);
  const height = Math.max(520, 280 + lines.length * 38);
  const author = input.anonymous ? "匿名同学" : input.authorName;
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input.createdAt);

  const body = lines
    .map((line, index) => `<text x="${padding}" y="${210 + index * 38}" class="body">${escapeXml(line)}</text>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="rainbow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#42a5f5"/>
      <stop offset="38%" stop-color="#ff6fae"/>
      <stop offset="72%" stop-color="#f8d64e"/>
      <stop offset="100%" stop-color="#8bc34a"/>
    </linearGradient>
    <style>
      .brand{font:900 52px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#061328}
      .meta{font:700 24px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#61718a}
      .body{font:800 30px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#172033}
      .foot{font:700 22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#ffffff}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="0" y="0" width="${width}" height="24" fill="url(#rainbow)"/>
  <text x="${padding}" y="92" class="brand">Campux</text>
  <text x="${padding + 232}" y="92" class="meta">${escapeXml(input.tenantName)}</text>
  <text x="${padding}" y="142" class="meta">${escapeXml(author)} · ${escapeXml(date)}</text>
  ${body}
  <rect x="${padding}" y="${height - 96}" width="250" height="54" rx="27" fill="url(#rainbow)"/>
  <text x="${padding + 34}" y="${height - 60}" class="foot">校园墙投稿</text>
</svg>`;

  return new TextEncoder().encode(svg);
}

function wrapText(text: string, maxLength: number) {
  const result: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    while (line.length > maxLength) {
      result.push(line.slice(0, maxLength));
      line = line.slice(maxLength);
    }
    if (line.length > 0) {
      result.push(line);
    }
  }

  return result.length > 0 ? result : [""];
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
