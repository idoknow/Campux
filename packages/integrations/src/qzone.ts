export type QZonePublishInput = {
  tenantId: string;
  postId: string;
  targetId: string;
  targetName: string;
  text: string;
  renderedCard: Uint8Array;
  imageUrls: string[];
  images?: Array<{
    name: string;
    bytes: Uint8Array;
  }>;
  cookies?: Record<string, string> | null;
};

export type QZoneHttpLog = {
  label: string;
  durationMs?: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: Record<string, string>;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    parsed?: unknown;
  };
  error?: string;
};

export type QZonePublishVerbose = {
  mode: "real-qzone";
  targetName: string;
  renderedBytes: number;
  imageCount: number;
  renderedImageIncluded: boolean;
  uploadedImages: Array<{
    name: string;
    bytes: number;
    picBo: string;
    richval: string;
  }>;
  cookieStatus: "available" | "missing";
  cookieNames: string[];
  uin: string | null;
  publishedAt: string | null;
  http: QZoneHttpLog[];
  note?: string;
};

export type QZonePublishResult = {
  externalId: string;
  verbose: QZonePublishVerbose;
};

export class QZonePublishError extends Error {
  verbose: QZonePublishVerbose;

  constructor(message: string, verbose: QZonePublishVerbose) {
    super(message);
    this.name = "QZonePublishError";
    this.verbose = verbose;
  }
}

const publishEndpoint = "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6";
const uploadImageEndpoint = "https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image";
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function publishToQZone(input: QZonePublishInput): Promise<QZonePublishResult> {
  const cookieNames = input.cookies ? Object.keys(input.cookies).sort() : [];
  const uin = normalizeUin(input.cookies);
  const verbose: QZonePublishVerbose = {
    mode: "real-qzone",
    targetName: input.targetName,
    renderedBytes: input.renderedCard.byteLength,
    imageCount: (input.images?.length ?? input.imageUrls.length) + 1,
    renderedImageIncluded: true,
    uploadedImages: [],
    cookieStatus: input.cookies && cookieNames.length > 0 ? "available" : "missing",
    cookieNames,
    uin,
    publishedAt: null,
    http: [],
    note: "发布正文来自机器人配文模板；稿件正文会进入渲染图，渲染图和投稿原图会作为 QZone 说说图片上传。",
  };

  if (!input.cookies || cookieNames.length === 0) {
    throw new QZonePublishError("缺少 QZone cookies，无法发布到 QQ 空间", verbose);
  }

  const pSkey = input.cookies.p_skey || input.cookies.skey;
  if (!pSkey) {
    throw new QZonePublishError("QZone cookies 缺少 p_skey/skey，无法计算 g_tk", verbose);
  }

  if (!uin) {
    throw new QZonePublishError("QZone cookies 缺少 uin/ptui_loginuin，无法确定发布账号", verbose);
  }

  const gtk = generateGtk(pSkey);
  const url = `${publishEndpoint}?g_tk=${encodeURIComponent(String(gtk))}`;
  const cookieHeader = toCookieHeader(input.cookies);
  const referer = `https://user.qzone.qq.com/${uin}`;
  const requestHeaders = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    cookie: redactCookieHeader(cookieHeader),
    origin: "https://user.qzone.qq.com",
    referer,
    "user-agent": userAgent,
  };
  const imagesToUpload = [
    { name: "rendered-card.jpg", bytes: input.renderedCard },
    ...(input.images ?? []),
  ];
  const uploadResults = [];
  for (const image of imagesToUpload) {
    uploadResults.push(await uploadQZoneImage({ image, cookies: input.cookies, cookieHeader, headers: requestHeaders, gtk, uin, verbose }));
  }

  const body = createPublishBody(input, uin, uploadResults);
  const log: QZoneHttpLog = {
    label: "publish_emotion",
    request: {
      method: "POST",
      url,
      headers: requestHeaders,
      body: Object.fromEntries(body.entries()),
    },
  };
  verbose.http.push(log);

  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...requestHeaders,
        cookie: cookieHeader,
      },
      body,
    });
    const text = await response.text();
    const parsed = parseQZoneResponse(text);
    log.durationMs = Date.now() - startedAt;
    log.response = {
      status: response.status,
      statusText: response.statusText,
      headers: pickResponseHeaders(response.headers),
      body: truncate(text, 8_000),
      parsed,
    };

    const success = isPublishSuccess(response, parsed);
    if (!success.ok) {
      throw new QZonePublishError(success.message, verbose);
    }

    verbose.publishedAt = new Date().toISOString();
    return {
      externalId: success.externalId,
      verbose,
    };
  } catch (caught) {
    if (caught instanceof QZonePublishError) {
      throw caught;
    }
    log.durationMs = Date.now() - startedAt;
    log.error = caught instanceof Error ? caught.message : String(caught);
    throw new QZonePublishError(`QZone 发布请求失败：${log.error}`, verbose);
  }
}

async function uploadQZoneImage({
  image,
  cookies,
  cookieHeader,
  headers,
  gtk,
  uin,
  verbose,
}: {
  image: { name: string; bytes: Uint8Array };
  cookies: Record<string, string>;
  cookieHeader: string;
  headers: Record<string, string>;
  gtk: number;
  uin: string;
  verbose: QZonePublishVerbose;
}) {
  const body = new URLSearchParams();
  body.set("filename", image.name);
  body.set("zzpanelkey", "");
  body.set("uploadtype", "1");
  body.set("albumtype", "7");
  body.set("exttype", "0");
  body.set("skey", cookies.skey || cookies.p_skey || "");
  body.set("zzpaneluin", uin);
  body.set("p_uin", uin);
  body.set("uin", uin);
  body.set("p_skey", cookies.p_skey || cookies.skey || "");
  body.set("output_type", "json");
  body.set("qzonetoken", "");
  body.set("refer", "shuoshuo");
  body.set("charset", "utf-8");
  body.set("output_charset", "utf-8");
  body.set("upload_hd", "1");
  body.set("hd_width", "2048");
  body.set("hd_height", "10000");
  body.set("hd_quality", "96");
  body.set("backUrls", "http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image,http://119.147.64.75/cgi-bin/upload/cgi_upload_image");
  body.set("url", `${uploadImageEndpoint}?g_tk=${gtk}`);
  body.set("base64", "1");
  body.set("picfile", toBase64(image.bytes));

  const log: QZoneHttpLog = {
    label: `upload_image:${image.name}`,
    request: {
      method: "POST",
      url: uploadImageEndpoint,
      headers,
      body: {
        ...Object.fromEntries(body.entries()),
        picfile: `<base64 ${image.bytes.byteLength} bytes>`,
      },
    },
  };
  verbose.http.push(log);

  const startedAt = Date.now();
  try {
    const response = await fetch(uploadImageEndpoint, {
      method: "POST",
      headers: {
        ...headers,
        cookie: cookieHeader,
      },
      body,
    });
    const text = await response.text();
    const parsed = parseQZoneUploadResponse(text);
    log.durationMs = Date.now() - startedAt;
    log.response = {
      status: response.status,
      statusText: response.statusText,
      headers: pickResponseHeaders(response.headers),
      body: truncate(text, 8_000),
      parsed,
    };

    if (!response.ok) {
      throw new QZonePublishError(`QZone 图片上传 HTTP ${response.status} ${response.statusText || ""}`.trim(), verbose);
    }
    const uploadInfo = getPicBoAndRichval(parsed);
    const result = {
      name: image.name,
      bytes: image.bytes.byteLength,
      ...uploadInfo,
    };
    verbose.uploadedImages.push(result);
    return result;
  } catch (caught) {
    if (caught instanceof QZonePublishError) {
      throw caught;
    }
    log.durationMs = Date.now() - startedAt;
    log.error = caught instanceof Error ? caught.message : String(caught);
    throw new QZonePublishError(`QZone 图片上传失败：${log.error}`, verbose);
  }
}

function createPublishBody(input: QZonePublishInput, uin: string, uploadedImages: Array<{ picBo: string; richval: string }>) {
  const body = new URLSearchParams();
  body.set("syn_tweet_verson", "1");
  body.set("paramstr", "1");
  body.set("pic_template", "");
  body.set("richtype", "");
  body.set("richval", "");
  body.set("special_url", "");
  body.set("subrichtype", "");
  body.set("who", "1");
  body.set("con", input.text);
  body.set("feedversion", "1");
  body.set("ver", "1");
  body.set("ugc_right", "1");
  body.set("to_sign", "0");
  body.set("hostuin", uin);
  body.set("code_version", "1");
  body.set("format", "json");
  body.set("qzreferrer", `https://user.qzone.qq.com/${uin}`);
  if (uploadedImages.length > 0) {
    body.set("pic_bo", uploadedImages.map((image) => image.picBo).join(","));
    body.set("richtype", "1");
    body.set("richval", uploadedImages.map((image) => image.richval).join("\t"));
  }
  return body;
}

function getPicBoAndRichval(parsed: unknown) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("QZone 图片上传没有返回可解析的 JSON");
  }
  const record = parsed as Record<string, unknown>;
  if (toNumber(record.ret) !== 0) {
    throw new Error(`QZone 图片上传被拒绝：${String(record.message ?? record.msg ?? record.ret ?? "未知错误")}`);
  }
  const data = record.data;
  if (!data || typeof data !== "object") {
    throw new Error("QZone 图片上传响应缺少 data");
  }
  const item = data as Record<string, unknown>;
  const url = firstString(item.url);
  const albumid = firstString(item.albumid);
  const lloc = firstString(item.lloc);
  const sloc = firstString(item.sloc);
  const type = firstString(item.type);
  const height = firstString(item.height);
  const width = firstString(item.width);
  const picBo = url?.split("&bo=")[1];
  if (!picBo || !albumid || !lloc || !sloc || !type || !height || !width) {
    throw new Error("QZone 图片上传响应缺少 pic_bo/richval 必要字段");
  }
  return {
    picBo,
    richval: `,${albumid},${lloc},${sloc},${type},${height},${width},,${height},${width}`,
  };
}

function normalizeUin(cookies: Record<string, string> | null | undefined) {
  if (!cookies) {
    return null;
  }
  const candidate = cookies.uin || cookies.ptui_loginuin || cookies.pt2gguin || cookies.qq;
  if (!candidate) {
    return null;
  }
  const digits = candidate.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function generateGtk(skey: string) {
  let hash = 5381;
  for (let index = 0; index < skey.length; index += 1) {
    hash += (hash << 5) + skey.charCodeAt(index);
  }
  return hash & 0x7fffffff;
}

function toCookieHeader(cookies: Record<string, string>) {
  return Object.entries(cookies)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function redactCookieHeader(value: string) {
  if (!value) {
    return "";
  }
  return value
    .split(";")
    .map((part) => {
      const [name] = part.trim().split("=");
      return name ? `${name}=<redacted>` : "<redacted>";
    })
    .join("; ");
}

function pickResponseHeaders(headers: Headers) {
  const picked: Record<string, string> = {};
  for (const name of ["content-type", "date", "server", "set-cookie"]) {
    const value = headers.get(name);
    if (value) {
      picked[name] = name === "set-cookie" ? "<redacted>" : value;
    }
  }
  return picked;
}

function parseQZoneResponse(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/^[^(]*\((.*)\)\s*;?$/s);
    if (match?.[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseQZoneUploadResponse(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return parseQZoneResponse(text);
  }
}

function isPublishSuccess(response: Response, parsed: unknown): { ok: true; externalId: string } | { ok: false; message: string } {
  if (!response.ok) {
    return {
      ok: false,
      message: `QZone 发布 HTTP ${response.status} ${response.statusText || ""}`.trim(),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      message: "QZone 发布没有返回可解析的 JSON",
    };
  }

  const record = parsed as Record<string, unknown>;
  const numericFlags = [record.code, record.ret, record.subcode].map(toNumber).filter((value): value is number => value !== null);
  const nonZero = numericFlags.find((value) => value !== 0);
  if (nonZero !== undefined) {
    return {
      ok: false,
      message: `QZone 发布被拒绝：${String(record.message ?? record.msg ?? `返回码 ${nonZero}`)}`,
    };
  }

  const externalId = findExternalId(record);
  if (numericFlags.includes(0) || externalId) {
    return {
      ok: true,
      externalId: externalId ?? `qzone-${Date.now()}`,
    };
  }

  return {
    ok: false,
    message: "QZone 发布响应缺少成功标记",
  };
}

function findExternalId(record: Record<string, unknown>) {
  const direct = firstString(record.tid, record.feedid, record.cellid, record.id);
  if (direct) {
    return direct;
  }
  const data = record.data;
  if (data && typeof data === "object") {
    return firstString(...Object.values(data as Record<string, unknown>));
  }
  return null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... <truncated ${value.length - maxLength} chars>` : value;
}

function toBase64(value: Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}
