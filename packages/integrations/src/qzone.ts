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
  qzoneTid: string | null;
  publishedAt: string | null;
  http: QZoneHttpLog[];
  note?: string;
};

export type QZonePublishResult = {
  externalId: string;
  qzoneTid: string | null;
  verbose: QZonePublishVerbose;
};

export type QZoneRecallInput = {
  targetName: string;
  externalId: string;
  cookies?: Record<string, string> | null;
};

export type QZoneRecallVerbose = {
  mode: "real-qzone-recall";
  targetName: string;
  externalId: string;
  cookieStatus: "available" | "missing";
  cookieNames: string[];
  uin: string | null;
  recalledAt: string | null;
  http: QZoneHttpLog[];
  note?: string;
};

export type QZoneRecallResult = {
  externalId: string;
  verbose: QZoneRecallVerbose;
};

export type QZoneEmotionMetricsInput = {
  uin: string;
  tid: string;
  cookies?: Record<string, string> | null;
  timeoutMs?: number;
};

export type QZoneEmotionMetricsVerbose = {
  mode: "real-qzone-emotion-metrics";
  uin: string;
  tid: string;
  cookieStatus: "available" | "missing";
  cookieNames: string[];
  checkedAt: string | null;
  http: QZoneHttpLog[];
  note?: string;
};

export type QZoneEmotionMetricsResult = {
  // PRD = 浏览量（阅读数）。部分账号不返回时为 null。
  visitorCount: number | null;
  likeCount: number;
  commentCount: number;
  forwardCount: number;
  verbose: QZoneEmotionMetricsVerbose;
};

export type QZoneCommentReply = {
  uin: string;
  name: string;
  content: string;
  images: string[];
  createdAt: string | null;
};

export type QZoneComment = {
  uin: string;
  name: string;
  content: string;
  images: string[];
  createdAt: string | null;
  replies: QZoneCommentReply[];
};

export type QZoneEmotionCommentsResult = {
  comments: QZoneComment[];
  verbose: QZoneEmotionMetricsVerbose;
};

export class QZonePublishError extends Error {
  verbose: QZonePublishVerbose;

  constructor(message: string, verbose: QZonePublishVerbose) {
    super(message);
    this.name = "QZonePublishError";
    this.verbose = verbose;
  }
}

export class QZoneRecallError extends Error {
  verbose: QZoneRecallVerbose;

  constructor(message: string, verbose: QZoneRecallVerbose) {
    super(message);
    this.name = "QZoneRecallError";
    this.verbose = verbose;
  }
}

export class QZoneEmotionMetricsError extends Error {
  verbose: QZoneEmotionMetricsVerbose;

  constructor(message: string, verbose: QZoneEmotionMetricsVerbose) {
    super(message);
    this.name = "QZoneEmotionMetricsError";
    this.verbose = verbose;
  }
}

const publishEndpoint = "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6";
const emotionDetailEndpoint = "https://h5.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6";
const emotionUpdateEndpoint = "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_update";
const emotionMetricsEndpoint = "https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2";
const uploadImageEndpoint = "https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image";
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function getQZoneEmotionMetrics(input: QZoneEmotionMetricsInput): Promise<QZoneEmotionMetricsResult> {
  const cookieNames = input.cookies ? Object.keys(input.cookies).sort() : [];
  const cookieHeader = input.cookies ? toCookieHeader(input.cookies) : "";
  const verbose: QZoneEmotionMetricsVerbose = {
    mode: "real-qzone-emotion-metrics",
    uin: input.uin,
    tid: input.tid,
    cookieStatus: input.cookies && cookieNames.length > 0 ? "available" : "missing",
    cookieNames,
    checkedAt: null,
    http: [],
    note: "互动数据来自 QZone qz_opcnt2（appid=311 才会返回 newdata）：LIKE 点赞，PRD 浏览量，PVS 访客，CS 评论，ZS 转发。",
  };

  // 接口要求登录态 + g_tk 签名，缺一不可（无 g_tk 会直接 HTTP 500，无 cookie 返回 login error）。
  if (!input.cookies || cookieNames.length === 0) {
    throw new QZoneEmotionMetricsError("缺少 QZone cookies，无法获取单条互动数据", verbose);
  }
  const pSkey = input.cookies.p_skey || input.cookies.skey;
  if (!pSkey) {
    throw new QZoneEmotionMetricsError("QZone cookies 缺少 p_skey/skey，无法计算 g_tk", verbose);
  }
  const gtk = generateGtk(pSkey);
  const referer = `https://user.qzone.qq.com/${input.uin}`;
  const requestHeaders = {
    cookie: redactCookieHeader(cookieHeader),
    referer,
    "user-agent": userAgent,
  };
  const timeoutMs = input.timeoutMs ?? 10_000;

  // 关键：必须带 appid=311，否则响应不含 newdata 块（拿不到 PRD 浏览量 / CS 评论）。一个接口拿全所有计数。
  const unikey = `http://user.qzone.qq.com/${input.uin}/mood/${input.tid}`;
  const opcntUrl = `${emotionMetricsEndpoint}?g_tk=${encodeURIComponent(String(gtk))}&_stp=${encodeURIComponent(String(Math.floor(Date.now() / 1000)))}&unikey=${encodeURIComponent(unikey)}&appid=311&face=0&fupdate=1`;
  const opcntLog: QZoneHttpLog = {
    label: "emotion_opcnt",
    request: { method: "GET", url: opcntUrl, headers: requestHeaders },
  };
  verbose.http.push(opcntLog);

  const opcntStartedAt = Date.now();
  try {
    const response = await fetch(opcntUrl, {
      headers: { ...requestHeaders, cookie: cookieHeader },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const parsed = parseQZoneResponse(text);
    opcntLog.durationMs = Date.now() - opcntStartedAt;
    opcntLog.response = {
      status: response.status,
      statusText: response.statusText,
      headers: pickResponseHeaders(response.headers),
      body: truncate(text, 8_000),
      parsed,
    };
    if (!response.ok) {
      throw new QZoneEmotionMetricsError(`QZone 互动数据 HTTP ${response.status} ${response.statusText || ""}`.trim(), verbose);
    }
    const counts = parseQZoneEmotionMetricsPayload(parsed);
    verbose.checkedAt = new Date().toISOString();
    return {
      visitorCount: counts.visitorCount,
      likeCount: counts.likeCount,
      commentCount: counts.commentCount,
      forwardCount: counts.forwardCount,
      verbose,
    };
  } catch (caught) {
    if (caught instanceof QZoneEmotionMetricsError) {
      throw caught;
    }
    opcntLog.durationMs = Date.now() - opcntStartedAt;
    opcntLog.error = caught instanceof Error ? caught.message : String(caught);
    throw new QZoneEmotionMetricsError(`QZone 互动数据获取失败：${opcntLog.error}`, verbose);
  }
}

// 拉取单条说说的评论列表（emotion_cgi_msgdetail_v6，含楼中楼 list_3）。仅在已知有评论时调用，避免无谓请求。
export async function getQZoneEmotionComments(input: QZoneEmotionMetricsInput & { num?: number }): Promise<QZoneEmotionCommentsResult> {
  const cookieNames = input.cookies ? Object.keys(input.cookies).sort() : [];
  const cookieHeader = input.cookies ? toCookieHeader(input.cookies) : "";
  const verbose: QZoneEmotionMetricsVerbose = {
    mode: "real-qzone-emotion-metrics",
    uin: input.uin,
    tid: input.tid,
    cookieStatus: input.cookies && cookieNames.length > 0 ? "available" : "missing",
    cookieNames,
    checkedAt: null,
    http: [],
    note: "评论列表来自 emotion_cgi_msgdetail_v6 的 commentlist；楼中楼回复在每条评论的 list_3 中。",
  };

  if (!input.cookies || cookieNames.length === 0) {
    throw new QZoneEmotionMetricsError("缺少 QZone cookies，无法获取评论列表", verbose);
  }
  const pSkey = input.cookies.p_skey || input.cookies.skey;
  if (!pSkey) {
    throw new QZoneEmotionMetricsError("QZone cookies 缺少 p_skey/skey，无法计算 g_tk", verbose);
  }
  const gtk = generateGtk(pSkey);
  const referer = `https://user.qzone.qq.com/${input.uin}`;
  const requestHeaders = {
    cookie: redactCookieHeader(cookieHeader),
    referer,
    "user-agent": userAgent,
  };
  const timeoutMs = input.timeoutMs ?? 10_000;
  const num = Math.min(Math.max(input.num ?? 20, 1), 100);
  const random = Math.random().toString();
  const url = `${emotionDetailEndpoint}?r=${encodeURIComponent(random)}&not_adapt_outpic=1&random=${encodeURIComponent(random)}&tid=${encodeURIComponent(input.tid)}&uin=${encodeURIComponent(input.uin)}&t1_source=1&not_trunc_con=1&need_right=1&pos=0&num=${num}&need_private_comment=1&g_tk=${encodeURIComponent(String(gtk))}`;
  const log: QZoneHttpLog = {
    label: "emotion_comments",
    request: { method: "GET", url, headers: requestHeaders },
  };
  verbose.http.push(log);

  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { ...requestHeaders, cookie: cookieHeader },
      signal: AbortSignal.timeout(timeoutMs),
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
    if (!response.ok) {
      throw new QZoneEmotionMetricsError(`QZone 评论列表 HTTP ${response.status} ${response.statusText || ""}`.trim(), verbose);
    }
    const comments = parseQZoneCommentList(parsed);
    verbose.checkedAt = new Date().toISOString();
    return { comments, verbose };
  } catch (caught) {
    if (caught instanceof QZoneEmotionMetricsError) {
      throw caught;
    }
    log.durationMs = Date.now() - startedAt;
    log.error = caught instanceof Error ? caught.message : String(caught);
    throw new QZoneEmotionMetricsError(`QZone 评论列表获取失败：${log.error}`, verbose);
  }
}

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
    qzoneTid: null,
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
    verbose.qzoneTid = success.qzoneTid;
    return {
      externalId: success.externalId,
      qzoneTid: success.qzoneTid,
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

export async function setQZoneEmotionPrivate(input: QZoneRecallInput): Promise<QZoneRecallResult> {
  const cookieNames = input.cookies ? Object.keys(input.cookies).sort() : [];
  const uin = normalizeUin(input.cookies);
  const verbose: QZoneRecallVerbose = {
    mode: "real-qzone-recall",
    targetName: input.targetName,
    externalId: input.externalId,
    cookieStatus: input.cookies && cookieNames.length > 0 ? "available" : "missing",
    cookieNames,
    uin,
    recalledAt: null,
    http: [],
    note: "撤回不会删除 QQ 空间说说，而是通过 QZone 访问权限把说说改为仅自己可见。",
  };

  if (!input.cookies || cookieNames.length === 0) {
    throw new QZoneRecallError("缺少 QZone cookies，无法撤回 QQ 空间说说", verbose);
  }

  const pSkey = input.cookies.p_skey || input.cookies.skey;
  if (!pSkey) {
    throw new QZoneRecallError("QZone cookies 缺少 p_skey/skey，无法计算 g_tk", verbose);
  }

  if (!uin) {
    throw new QZoneRecallError("QZone cookies 缺少 uin/ptui_loginuin，无法确定发布账号", verbose);
  }

  const gtk = generateGtk(pSkey);
  const cookieHeader = toCookieHeader(input.cookies);
  const requestHeaders = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    cookie: redactCookieHeader(cookieHeader),
    origin: "https://user.qzone.qq.com",
    referer: `https://user.qzone.qq.com/${uin}/main`,
    "user-agent": userAgent,
  };

  const detail = await getQZoneEmotionDetail({
    tid: input.externalId,
    uin,
    gtk,
    cookieHeader,
    headers: requestHeaders,
    verbose,
  });
  await updateQZoneEmotionRight({
    tid: input.externalId,
    uin,
    gtk,
    cookieHeader,
    headers: requestHeaders,
    detail,
    verbose,
  });

  verbose.recalledAt = new Date().toISOString();
  return {
    externalId: input.externalId,
    verbose,
  };
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

async function getQZoneEmotionDetail({
  tid,
  uin,
  gtk,
  cookieHeader,
  headers,
  verbose,
}: {
  tid: string;
  uin: string;
  gtk: number;
  cookieHeader: string;
  headers: Record<string, string>;
  verbose: QZoneRecallVerbose;
}) {
  const random = Math.random().toString();
  const url = `${emotionDetailEndpoint}?r=${encodeURIComponent(random)}&not_adapt_outpic=1&random=${encodeURIComponent(random)}&tid=${encodeURIComponent(tid)}&uin=${encodeURIComponent(uin)}&t1_source=1&not_trunc_con=1&need_right=1&g_tk=${encodeURIComponent(String(gtk))}`;
  const log: QZoneHttpLog = {
    label: "recall_detail",
    request: {
      method: "GET",
      url,
      headers,
    },
  };
  verbose.http.push(log);

  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        ...headers,
        cookie: cookieHeader,
      },
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
    if (!response.ok) {
      throw new QZoneRecallError(`QZone 说说详情 HTTP ${response.status} ${response.statusText || ""}`.trim(), verbose);
    }
    return parseEmotionDetail(parsed, verbose);
  } catch (caught) {
    if (caught instanceof QZoneRecallError) {
      throw caught;
    }
    log.durationMs = Date.now() - startedAt;
    log.error = caught instanceof Error ? caught.message : String(caught);
    throw new QZoneRecallError(`QZone 说说详情获取失败：${log.error}`, verbose);
  }
}

async function updateQZoneEmotionRight({
  tid,
  uin,
  gtk,
  cookieHeader,
  headers,
  detail,
  verbose,
}: {
  tid: string;
  uin: string;
  gtk: number;
  cookieHeader: string;
  headers: Record<string, string>;
  detail: QZoneEmotionDetail;
  verbose: QZoneRecallVerbose;
}) {
  const url = `${emotionUpdateEndpoint}?g_tk=${encodeURIComponent(String(gtk))}`;
  const body = createRecallBody(tid, uin, detail);
  const log: QZoneHttpLog = {
    label: "recall_update_private",
    request: {
      method: "POST",
      url,
      headers,
      body: Object.fromEntries(body.entries()),
    },
  };
  verbose.http.push(log);

  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
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

    const success = isRecallSuccess(response, parsed, text);
    if (!success.ok) {
      throw new QZoneRecallError(success.message, verbose);
    }
  } catch (caught) {
    if (caught instanceof QZoneRecallError) {
      throw caught;
    }
    log.durationMs = Date.now() - startedAt;
    log.error = caught instanceof Error ? caught.message : String(caught);
    throw new QZoneRecallError(`QZone 撤回请求失败：${log.error}`, verbose);
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

type QZoneEmotionDetail = {
  content: string;
  pictures: Array<{
    picId: string;
    picType: string;
    height: string;
    width: string;
    smallUrl: string;
  }>;
};

function parseEmotionDetail(parsed: unknown, verbose: QZoneRecallVerbose): QZoneEmotionDetail {
  if (!parsed || typeof parsed !== "object") {
    throw new QZoneRecallError("QZone 说说详情没有返回可解析的 JSON", verbose);
  }
  const record = parsed as Record<string, unknown>;
  const code = toNumber(record.code ?? record.ret);
  if (code !== null && code !== 0) {
    throw new QZoneRecallError(`QZone 说说详情被拒绝：${String(record.message ?? record.msg ?? `返回码 ${code}`)}`, verbose);
  }
  const content = firstString(record.content, record.con);
  if (content === null) {
    throw new QZoneRecallError("QZone 说说详情缺少正文内容", verbose);
  }

  const rawPictures = Array.isArray(record.pic) ? record.pic : [];
  const pictures = rawPictures
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const picture = item as Record<string, unknown>;
      const picId = firstString(picture.pic_id, picture.picId);
      const picType = firstString(picture.pictype, picture.picType, picture.type);
      const height = firstString(picture.height);
      const width = firstString(picture.width);
      const smallUrl = firstString(picture.smallurl, picture.smallUrl, picture.url);
      if (!picId || !picType || !height || !width || !smallUrl) {
        return null;
      }
      return {
        picId,
        picType,
        height,
        width,
        smallUrl,
      };
    })
    .filter((item): item is QZoneEmotionDetail["pictures"][number] => item !== null);

  return {
    content,
    pictures,
  };
}

function createRecallBody(tid: string, uin: string, detail: QZoneEmotionDetail) {
  const body = new URLSearchParams();
  body.set("syn_tweet_verson", "1");
  body.set("tid", tid);
  body.set("paramstr", "1");
  body.set("pic_template", "");
  body.set("richtype", "");
  body.set("richval", "");
  body.set("special_url", "");
  body.set("subrichtype", "");
  body.set("con", detail.content);
  body.set("feedversion", "1");
  body.set("ver", "1");
  body.set("ugc_right", "64");
  body.set("to_sign", "0");
  body.set("ugcright_id", tid);
  body.set("hostuin", uin);
  body.set("code_version", "1");
  body.set("format", "fs");
  body.set("qzreferrer", `https://user.qzone.qq.com/${uin}/main`);

  const richvals: string[] = [];
  const picBos: string[] = [];
  for (const picture of detail.pictures) {
    const parts = picture.picId.split(",");
    const albumId = parts[1];
    const lloc = parts[2];
    if (!albumId || !lloc) {
      continue;
    }
    richvals.push(`,${albumId},${lloc},${lloc},${picture.picType},${picture.height},${picture.width},,0,0`);
    const picBo = extractPicBo(picture.smallUrl);
    if (picBo) {
      picBos.push(picBo);
    }
  }

  if (richvals.length > 0 && picBos.length > 0) {
    body.set("richtype", "1");
    body.set("subrichtype", "1");
    body.set("richval", richvals.join("\t"));
    body.set("pic_bo", picBos.join("\t"));
  }
  return body;
}

function extractPicBo(value: string) {
  try {
    const parsed = new URL(value);
    const bo = parsed.searchParams.get("bo");
    if (bo) {
      return bo;
    }
  } catch {
    // Fall through to the historical split-based parser.
  }
  return value.split("bo=")[1]?.split("&")[0] ?? null;
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

// 解析 emotion_cgi_msgdetail_v6 的 commentlist：评论人、内容、时间、楼中楼回复（list_3）。
export function parseQZoneCommentList(parsed: unknown): QZoneComment[] {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("QZone 评论列表没有返回可解析的 JSON");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.code === "number" && record.code !== 0) {
    throw new Error(String(record.message ?? record.msg ?? `QZone 评论列表返回错误码 ${record.code}`));
  }
  const list = Array.isArray(record.commentlist) ? record.commentlist : [];
  const comments: QZoneComment[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const c = raw as Record<string, unknown>;
    const replies: QZoneCommentReply[] = [];
    const replyList = Array.isArray(c.list_3) ? c.list_3 : [];
    for (const rawReply of replyList) {
      if (!rawReply || typeof rawReply !== "object") {
        continue;
      }
      const r = rawReply as Record<string, unknown>;
      replies.push({
        uin: r.uin !== undefined && r.uin !== null ? String(r.uin) : "",
        name: typeof r.name === "string" ? r.name : "",
        content: cleanQZoneCommentContent(r.content),
        images: extractQZoneCommentImages(r),
        createdAt: qzoneCommentTime(r),
      });
    }
    comments.push({
      uin: c.uin !== undefined && c.uin !== null ? String(c.uin) : "",
      name: typeof c.name === "string" ? c.name : "",
      content: cleanQZoneCommentContent(c.content),
      images: extractQZoneCommentImages(c),
      createdAt: qzoneCommentTime(c),
      replies,
    });
  }
  return comments;
}

function qzoneCommentTime(record: Record<string, unknown>): string | null {
  const epoch = toNumber(record.create_time);
  if (epoch !== null && epoch > 0) {
    return new Date(epoch * 1000).toISOString();
  }
  if (typeof record.createTime2 === "string" && record.createTime2.trim()) {
    return record.createTime2;
  }
  return null;
}

// QZone 评论里的表情码 [em]exxxx[/em] 与 @{uin:x,nick:名字,...} 提及需要清洗成可读文本。
function cleanQZoneCommentContent(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/@\{uin:\d+,nick:([^,}]*)[^}]*\}/g, "@$1")
    .replace(/\[em\]e\d+\[\/em\]/g, "[表情]")
    .trim();
}

// 图片评论的正文为空，图片在 pic[]（b_url/o_url/hd_url/s_url）或 rich_info[].burl 中。
// 历史上解析器只取了 content，导致图片评论显示成「(空)」。这里把图片 URL 提取出来。
function extractQZoneCommentImages(record: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const pushUrl = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed) && !urls.includes(trimmed)) {
        urls.push(trimmed);
      }
    }
  };
  const pics = Array.isArray(record.pic) ? record.pic : [];
  for (const pic of pics) {
    if (!pic || typeof pic !== "object") {
      continue;
    }
    const p = pic as Record<string, unknown>;
    // 优先大图，依次回退到高清/原图/缩略图。
    const candidate = p.b_url ?? p.o_url ?? p.hd_url ?? p.url1 ?? p.url2 ?? p.url3 ?? p.smallurl ?? p.s_url;
    if (candidate !== undefined) {
      pushUrl(candidate);
    } else {
      // 兜底：取该 pic 对象里第一个 http(s) 字段。
      for (const value of Object.values(p)) {
        if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
          pushUrl(value);
          break;
        }
      }
    }
  }
  // rich_info[].burl 作为补充来源（与 pic 去重）。
  const richInfo = Array.isArray(record.rich_info) ? record.rich_info : [];
  for (const item of richInfo) {
    if (!item || typeof item !== "object") {
      continue;
    }
    pushUrl((item as Record<string, unknown>).burl);
  }
  return urls;
}

// qz_opcnt2（带 appid=311）返回 data[0].current.newdata = { LIKE, PRD, PVS, CS, ZS, ... }。
// LIKE=点赞, PRD=浏览量(阅读数), PVS=访客数, CS=评论, ZS=转发。
export function parseQZoneEmotionMetricsPayload(parsed: unknown): {
  visitorCount: number | null;
  likeCount: number;
  commentCount: number;
  forwardCount: number;
} {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("QZone 互动数据没有返回可解析的 JSON");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.code === "number" && record.code !== 0) {
    throw new Error(String(record.message ?? record.msg ?? `QZone 互动数据返回错误码 ${record.code}`));
  }
  const data = Array.isArray(record.data) ? record.data[0] : null;
  if (!data || typeof data !== "object") {
    throw new Error(String(record.message ?? record.msg ?? "QZone 互动数据缺少 data"));
  }
  const current = (data as Record<string, unknown>).current;
  if (!current || typeof current !== "object") {
    throw new Error("QZone 互动数据缺少 current");
  }
  const currentRecord = current as Record<string, unknown>;
  const newdata = currentRecord.newdata;
  if (!newdata || typeof newdata !== "object") {
    throw new Error("QZone 互动数据缺少 newdata（请确认请求带了 appid=311），可能是 tid 无效或无权访问");
  }
  const nd = newdata as Record<string, unknown>;
  // cntdata 作为点赞的兜底来源（newdata.LIKE 应当一致）。
  const cntdata = (currentRecord.cntdata && typeof currentRecord.cntdata === "object" ? currentRecord.cntdata : {}) as Record<string, unknown>;
  const likeCount = toNumber(nd.LIKE) ?? toNumber(cntdata.like) ?? 0;
  const commentCount = toNumber(nd.CS) ?? 0;
  const forwardCount = toNumber(nd.ZS) ?? ((toNumber(cntdata.forward) ?? 0) + (toNumber(cntdata.share) ?? 0));
  // PRD = 浏览量（阅读数）。部分账号可能不返回该字段（隐私/未开启），此时为 null。
  const visitorCount = toNumber(nd.PRD);
  return {
    visitorCount: visitorCount !== null && visitorCount >= 0 ? visitorCount : null,
    likeCount: likeCount >= 0 ? likeCount : 0,
    commentCount: commentCount >= 0 ? commentCount : 0,
    forwardCount: forwardCount >= 0 ? forwardCount : 0,
  };
}

function isPublishSuccess(response: Response, parsed: unknown): { ok: true; externalId: string; qzoneTid: string | null } | { ok: false; message: string } {
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
      qzoneTid: externalId,
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

function isRecallSuccess(response: Response, parsed: unknown, rawText: string): { ok: true } | { ok: false; message: string } {
  if (!response.ok) {
    return {
      ok: false,
      message: `QZone 撤回 HTTP ${response.status} ${response.statusText || ""}`.trim(),
    };
  }

  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const numericFlags = [record.code, record.ret, record.subcode].map(toNumber).filter((value): value is number => value !== null);
    const nonZero = numericFlags.find((value) => value !== 0);
    if (nonZero !== undefined) {
      return {
        ok: false,
        message: `QZone 撤回被拒绝：${String(record.message ?? record.msg ?? `返回码 ${nonZero}`)}`,
      };
    }
    if (numericFlags.includes(0)) {
      return {
        ok: true,
      };
    }
  }

  if (/"(?:code|ret|subcode)"\s*:\s*0/.test(rawText) || /callback\(\s*0\s*\)/i.test(rawText)) {
    return {
      ok: true,
    };
  }

  return {
    ok: false,
    message: "QZone 撤回响应缺少成功标记",
  };
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
