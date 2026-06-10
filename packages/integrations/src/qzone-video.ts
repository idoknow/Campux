import { createHash, randomBytes } from "node:crypto";

/**
 * QZone (QQ空间) 视频发布 —— 复刻 QQ NTV2 RichMedia 上传协议（服务端 HTTP/protobuf）。
 *
 * 流程：ApplyBatch → HandleProcess(cmd:100) → sliceupload → HandleProcess(cmd:103) →
 *       FinishBatch → 查相册拿 lloc → PublishFeed。视频与封面各走一遍上传：
 *       视频 businessType:2（视频存储 1483），封面 businessType:1（图片存储 1482）。
 *
 * 关键坑（见 memory: project-qzone-video-publish-protocol）：
 *  - cmd:103 的 extendInfo 必须用 **sliceupload 响应里** 的 ext_info（已落库的签名态），
 *    用 cmd:100 的会 400(10060)。
 *  - ukey 直接当字符串字节用，不要 base64 decode；ext_info 要 base64 decode。
 *  - cookies(skey/p_skey) 会轮换，g_tk 要用当前 cookies 现算。
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type QZoneVideoInput = {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** 时长（秒） */
  durationSec: number;
  fileName?: string;
};

export type QZoneVideoPublishInput = {
  targetName: string;
  text: string;
  video: QZoneVideoInput;
  /** 封面 JPEG（视频某一帧；由前端/服务端生成） */
  cover: Uint8Array;
  cookies: Record<string, string> | null;
};

export type QZoneVideoHttpLog = {
  label: string;
  status?: number;
  ok?: boolean;
  note?: string;
};

export type QZoneVideoPublishVerbose = {
  mode: "real-qzone-video";
  targetName: string;
  uin: string | null;
  albumId: string | null;
  batchId: string | null;
  vid: string | null;
  coverLloc: string | null;
  feedId: string | null;
  publishedAt: string | null;
  http: QZoneVideoHttpLog[];
  note?: string;
};

export type QZoneVideoPublishResult = {
  externalId: string;
  vid: string;
  feedId: string | null;
  verbose: QZoneVideoPublishVerbose;
};

export class QZoneVideoPublishError extends Error {
  verbose: QZoneVideoPublishVerbose;
  constructor(message: string, verbose: QZoneVideoPublishVerbose) {
    super(message);
    this.name = "QZoneVideoPublishError";
    this.verbose = verbose;
  }
}

// ---- protobuf encode ----
function uvarint(n: number | bigint): Buffer {
  let v = BigInt(n);
  const b: number[] = [];
  do {
    const x = Number(v & 0x7fn);
    v >>= 7n;
    b.push(v ? x | 0x80 : x);
  } while (v);
  return Buffer.from(b);
}
function tag(fieldNo: number, wireType: number) {
  return uvarint((fieldNo << 3) | wireType);
}
function pbVarint(fieldNo: number, n: number | bigint) {
  return Buffer.concat([tag(fieldNo, 0), uvarint(n)]);
}
function pbBytes(fieldNo: number, buf: Buffer | string) {
  const b = Buffer.from(buf as Buffer);
  return Buffer.concat([tag(fieldNo, 2), uvarint(b.length), b]);
}
function readVarint(b: Buffer, i: number): [number, number] {
  let v = 0;
  let s = 0;
  while (true) {
    const x = b[i++];
    v |= (x & 0x7f) << s;
    s += 7;
    if (!(x & 0x80)) break;
  }
  return [v, i];
}

/** 从 sliceupload 响应里抽出 qqnt_signed ext_info 消息（cmd:103 必须用这一份）。 */
function extractCommittedExtInfo(buf: Buffer): Buffer | null {
  const marker = Buffer.from("0a2071716e74", "hex"); // \n\x20 "qqnt"
  const idx = buf.indexOf(marker);
  if (idx < 0) return null;
  let i = idx + 2 + 32; // f1: tag+len(0x20) + 32B "qqnt_signed_extinfo_hmac_sha1_v1"
  i += 2 + 20; // f2: tag+len(0x14) + 20B hmac
  i += 1; // f3 tag
  let l3: number;
  [l3, i] = readVarint(buf, i);
  i += l3;
  if (buf[i] === 0x20) {
    i += 1;
    [, i] = readVarint(buf, i); // optional f4 (timestamp)
  }
  return buf.slice(idx, i);
}

function generateGtk(skey: string) {
  let hash = 5381;
  for (let i = 0; i < skey.length; i += 1) hash += (hash << 5) + skey.charCodeAt(i);
  return hash & 0x7fffffff;
}
function toCookieHeader(cookies: Record<string, string>) {
  return Object.entries(cookies)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
function normalizeUin(cookies: Record<string, string>) {
  const c = cookies.uin || cookies.ptui_loginuin || cookies.p_uin || "";
  const digits = c.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
function findLloc(s: string) {
  return (s.match(/[A-Za-z0-9_!*.+/-]{20,}!!/) || [])[0];
}
function sha1hex(b: Uint8Array) {
  return createHash("sha1").update(b).digest("hex");
}
function md5hex(b: Uint8Array) {
  return createHash("md5").update(b).digest("hex");
}
function clientFileId() {
  return `file_${Date.now()}_${randomBytes(5).toString("hex").slice(0, 9)}`;
}

export async function publishVideoToQZone(input: QZoneVideoPublishInput): Promise<QZoneVideoPublishResult> {
  const cookies = input.cookies ?? {};
  const uin = normalizeUin(cookies);
  const verbose: QZoneVideoPublishVerbose = {
    mode: "real-qzone-video",
    targetName: input.targetName,
    uin,
    albumId: null,
    batchId: null,
    vid: null,
    coverLloc: null,
    feedId: null,
    publishedAt: null,
    http: [],
    note: "视频走 QQ NTV2 RichMedia 上传到「说说和日志相册」，再 PublishFeed 成视频说说。",
  };

  if (!input.cookies || Object.keys(cookies).length === 0) {
    throw new QZoneVideoPublishError("缺少 QZone cookies，无法发布视频", verbose);
  }
  const pSkey = cookies.p_skey || cookies.skey;
  if (!pSkey) throw new QZoneVideoPublishError("QZone cookies 缺少 p_skey/skey", verbose);
  if (!uin) throw new QZoneVideoPublishError("QZone cookies 缺少 uin", verbose);

  const gtk = generateGtk(pSkey);
  const cookieHeader = toCookieHeader(cookies);
  const rpc = (path: string) => `https://user.qzone.qq.com/http2rpc/gotrpc/auth/${path}?bkn=${gtk}`;
  const hdr = (xoidb: string) => ({
    "content-type": "application/json",
    "x-oidb": xoidb,
    "x-requested-with": "XMLHttpRequest",
    cookie: cookieHeader,
    origin: "https://user.qzone.qq.com",
    referer: "https://user.qzone.qq.com/proxy/domain/qzonestyle.gtimg.cn/qzone/photo/v7/page/upload.html",
    "user-agent": UA,
  });

  async function rpcJson(label: string, path: string, xoidb: string, body: unknown): Promise<any> {
    let status = 0;
    try {
      const r = await fetch(rpc(path), { method: "POST", headers: hdr(xoidb), body: JSON.stringify(body) });
      status = r.status;
      const text = await r.text();
      verbose.http.push({ label, status, ok: r.ok });
      return JSON.parse(text);
    } catch (e) {
      verbose.http.push({ label, status, ok: false, note: e instanceof Error ? e.message : String(e) });
      throw new QZoneVideoPublishError(`QZone ${label} 失败：${e instanceof Error ? e.message : e}`, verbose);
    }
  }

  // 0. 找到「说说和日志相册」album id
  const albumId = await findShuoshuoAlbumId(uin, gtk, cookieHeader, verbose);
  verbose.albumId = albumId;

  // 1. ApplyBatch
  const applied = await rpcJson("ApplyBatch", "trpc.qzone.media_upload_logic.BatchUpload/ApplyBatch", '{"uint32_command":"0x9773","uint32_service_type":"1"}', {
    userId: uin,
    albumId,
    batchNum: 1,
    photoNum: 1,
    videoNum: 1,
    bizType: 1,
  });
  const batchId: string = applied?.data?.batch_id;
  if (!batchId) throw new QZoneVideoPublishError("ApplyBatch 未返回 batch_id", verbose);
  verbose.batchId = batchId;

  // 2. 上传视频
  const W = input.video.width;
  const H = input.video.height;
  const DUR = Math.max(1, Math.round(input.video.durationSec));
  const videoBuf = Buffer.from(input.video.bytes);
  const bizVideo = Buffer.concat([
    pbVarint(1, 1),
    pbVarint(3, 0),
    pbBytes(5, albumId),
    pbBytes(6, uin),
    pbVarint(7, BigInt(batchId)),
    pbVarint(8, 1),
    pbVarint(9, 0),
    pbBytes(99, clientFileId()),
  ]);
  const vr = await uploadOne({
    rpc, hdr, rpcJson, verbose, uin,
    buf: videoBuf,
    extraFileInfo: { fileType: { class: 2, videoCodecFormat: 0 }, width: W, height: H, time: DUR },
    biz: bizVideo,
    businessType: 2,
    fileName: input.video.fileName || "video.mp4",
  });
  if (!vr.vid) throw new QZoneVideoPublishError("视频上传未返回 vid", verbose);
  verbose.vid = vr.vid;

  // 3. 上传封面（businessType:1）
  const coverBuf = Buffer.from(input.cover);
  const bizCover = Buffer.concat([
    pbBytes(1, albumId),
    pbVarint(2, BigInt(batchId)),
    pbBytes(4, vr.vid),
    pbVarint(7, Math.floor(Date.now() / 1000)),
    pbVarint(8, 1),
    pbVarint(9, 0),
    pbBytes(17, uin),
    pbVarint(19, 1),
    pbBytes(21, Buffer.from([0x18, 0x00, 0x20, 0x00])),
    pbBytes(99, clientFileId()),
  ]);
  await uploadOne({
    rpc, hdr, rpcJson, verbose, uin,
    buf: coverBuf,
    extraFileInfo: { fileType: { class: 0 } },
    biz: bizCover,
    businessType: 1,
    fileName: "blob",
  });

  // 4. FinishBatch（落地相册条目 + 墙上「上传了视频」feed）
  await rpcJson("FinishBatch", "trpc.qzone.media_upload_logic.BatchUpload/FinishBatch", '{"uint32_command":"0x9774","uint32_service_type":"1"}', {
    userId: uin,
    albumId,
    batchId,
    clientKey: "",
    beginUploadTime: Date.now() - 4000,
    finishUploadTime: Date.now(),
    uploadSize: videoBuf.length,
    succPhotoNum: 0,
    succVideoNum: 1,
    bizType: 1,
  });

  // 5. 查相册拿已落库的 cover lloc
  await new Promise((r) => setTimeout(r, 2500));
  const coverLloc = await fetchNewestVideoLloc(uin, gtk, cookieHeader, albumId);
  verbose.coverLloc = coverLloc;
  if (!coverLloc) throw new QZoneVideoPublishError("FinishBatch 后未能取到相册视频 lloc", verbose);

  // 6. PublishFeed —— 生成可内联播放的视频说说
  const nowSec = Math.floor(Date.now() / 1000);
  const ck = `${uin}_${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const feed = {
    ext_info: { map_info: [{ key: "refer", value: "getPhotoList" }, { key: "entrance", value: "13" }] },
    feed: {
      cell_common: {
        app_id: 4, sub_id: 0, time: nowSec, feed_type: 1, feed_sub_type: 2, client_key: ck,
        union_id: { uf_key: ck, ugc_id: ck, feed_id: ck, ext_ids: [{ ext_id_type: 1, str: albumId }, { ext_id_type: 2, str: batchId }, { ext_id_type: 8, str: uin }] },
        feed_biz_type: 0, feature_flag: 0, operate_mask: 0, utime: 0,
      },
      cell_user_info: { user: { uin, nick: "" } },
      cell_media: {
        album_id: albumId, batch_id: batchId, upload_num: 1,
        media_items: [{ type: 1, batch_id: batchId, upload_time: nowSec, video: { id: vr.vid, width: W, height: H, video_time: DUR * 1000, cover: { lloc: coverLloc, sloc: coverLloc, default_url: { width: W, height: H } } } }],
      },
    },
    from: 1,
  };
  const published = await rpcJson("PublishFeed", "trpc.qzone.feeds_writer.FeedsWriter/PublishFeed", '{"uint32_command":"0x9775","uint32_service_type":"1"}', feed);
  if (published?.retcode !== 0) {
    throw new QZoneVideoPublishError(`PublishFeed 被拒绝：${published?.message || published?.retcode}`, verbose);
  }
  const feedId: string | null = published?.data?.feed?.cell_common?.union_id?.feed_id ?? ck;
  verbose.feedId = feedId;
  verbose.publishedAt = new Date().toISOString();

  return { externalId: feedId ?? vr.vid, vid: vr.vid, feedId, verbose };
}

/** 单文件上传：HandleProcess(cmd:100) → sliceupload → HandleProcess(cmd:103，用 sliceResp ext_info)。 */
async function uploadOne(args: {
  rpc: (p: string) => string;
  hdr: (x: string) => Record<string, string>;
  rpcJson: (label: string, path: string, xoidb: string, body: unknown) => Promise<any>;
  verbose: QZoneVideoPublishVerbose;
  uin: string;
  buf: Buffer;
  extraFileInfo: Record<string, unknown>;
  biz: Buffer;
  businessType: number;
  fileName: string;
}): Promise<{ vid?: string }> {
  const { rpc, hdr, rpcJson, verbose, uin, buf, extraFileInfo, biz, businessType, fileName } = args;
  const sha1 = sha1hex(buf);
  const md5 = md5hex(buf);
  const fileInfo100 = { size: buf.length, sha1, md5, fileName, ...extraFileInfo };
  const hp = await rpcJson(`HandleProcess:100:${fileName}`, "trpc.qqntv2.richmedia/HandleProcess", '{"uint32_command":"0x12a9","uint32_service_type":"100"}', {
    head: { commonHead: { requestId: String(Date.now()), cmd: 100 }, scene: { sceneType: 5, businessType, appType: 14 }, clientMeta: { agentType: 4 } },
    uploadReq: { uploadInfo: [{ fileInfo: fileInfo100, subType: 0 }], bizTransInfo: [...biz] },
  });
  const ur = hp?.data?.upload_rsp;
  const node = ur?.msg_info?.msg_info_body?.[0]?.index_node;
  if (!ur || !node) throw new QZoneVideoPublishError(`HandleProcess(cmd:100) 响应异常（${fileName}）`, verbose);
  const ukeyBytes = Buffer.from(String(ur.ukey)); // 注意：ukey 当字符串字节用
  const extInfo100 = Buffer.from(String(ur.extinfo[0].ext_info), "base64");

  // sliceupload（单分片）
  const sha1raw = Buffer.from(sha1, "hex");
  const inner = Buffer.concat([
    pbBytes(1, uin), pbBytes(2, ukeyBytes), pbVarint(3, 0), pbVarint(4, buf.length - 1),
    pbBytes(5, sha1raw), pbBytes(6, pbBytes(1, sha1raw)), pbBytes(7, buf), pbVarint(100, 5), pbBytes(101, extInfo100),
  ]);
  const outer = Buffer.concat([pbVarint(1, 1), pbVarint(2, node.store_appid), pbVarint(3, randomBytes(4).readUInt32BE(0)), pbBytes(107, inner)]);
  let slBuf: Buffer;
  try {
    const r = await fetch(`https://${ur.domain}/sliceupload`, { method: "POST", headers: { origin: "https://user.qzone.qq.com", referer: "https://user.qzone.qq.com/", "user-agent": UA }, body: outer });
    slBuf = Buffer.from(await r.arrayBuffer());
    verbose.http.push({ label: `sliceupload:${fileName}`, status: r.status, ok: r.ok });
  } catch (e) {
    verbose.http.push({ label: `sliceupload:${fileName}`, ok: false, note: e instanceof Error ? e.message : String(e) });
    throw new QZoneVideoPublishError(`sliceupload 失败（${fileName}）：${e instanceof Error ? e.message : e}`, verbose);
  }
  const vid = (slBuf.toString("latin1").match(/photovideo\.photo\.qq\.com\/([0-9]+_[0-9a-z]+)\.f/) || [])[1];
  const committedExt = extractCommittedExtInfo(slBuf) ?? extInfo100;

  // cmd:103（关键：用 sliceupload 响应里的 ext_info）
  const fileInfo103 = businessType === 2
    ? { size: buf.length, sha1, md5, fileName, width: extraFileInfo.width, height: extraFileInfo.height, time: extraFileInfo.time }
    : { size: buf.length, sha1, md5, fileName };
  const sync = await rpcJson(`HandleProcess:103:${fileName}`, "trpc.qqntv2.richmedia/HandleProcess", '{"uint32_command":"0x12a9","uint32_service_type":"103"}', {
    head: { commonHead: { requestId: String(Date.now()), cmd: 103 }, scene: { sceneType: 5, businessType, appType: 14 }, clientMeta: { agentType: 4 } },
    uploadStatusSyncReq: {
      indexNode: { fileUuid: node.file_uuid, fileInfo: fileInfo103, storeId: node.store_id ?? 1, storeAppid: node.store_appid },
      uploadStatus: { fileStatus: 2 },
      uploadChannelInfo: { extendType: 5, extendInfo: [...committedExt] },
      bizTransInfo: [...biz],
    },
  });
  const err = sync?.data?.upload_status_sync_rsp?.biz_error_info;
  if (err && err.err_code && err.err_code !== "0") {
    throw new QZoneVideoPublishError(`上传确认失败（${fileName}）：${err.err_msg || err.err_code}`, verbose);
  }
  return { vid };
}

const albumIdCache = new Map<string, { id: string; at: number }>();

/** 找到 bot 的「说说和日志相册」album id（带短缓存）。 */
async function findShuoshuoAlbumId(uin: string, gtk: number, cookieHeader: string, verbose: QZoneVideoPublishVerbose): Promise<string> {
  const cached = albumIdCache.get(uin);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.id;
  const url = `https://user.qzone.qq.com/proxy/domain/photo.qzone.qq.com/cgi-bin/fcg_list_album_v3?g_tk=${gtk}&hostUin=${uin}&uin=${uin}&inCharset=utf-8&outCharset=utf-8&source=qzone&plat=qzone&format=json&notice=0&filter=1&handset=4&pageNumModeSort=40&pageNumModeClass=15&needUserInfo=1&idcNum=4`;
  try {
    const r = await fetch(url, { headers: { cookie: cookieHeader, referer: `https://user.qzone.qq.com/${uin}`, "user-agent": UA } });
    const text = await r.text();
    verbose.http.push({ label: "list_album", status: r.status, ok: r.ok });
    const j = JSON.parse(text.replace(/^[^({]*\(/, "").replace(/\);?\s*$/, ""));
    const albums = j?.data?.albumListModeSort || j?.data?.albumList || [];
    const found = albums.find((a: any) => a.name === "说说和日志相册" || a.classid === 106);
    if (found?.id) {
      albumIdCache.set(uin, { id: found.id, at: Date.now() });
      return found.id;
    }
  } catch (e) {
    verbose.http.push({ label: "list_album", ok: false, note: e instanceof Error ? e.message : String(e) });
  }
  throw new QZoneVideoPublishError("找不到「说说和日志相册」，无法发布视频", verbose);
}

/** FinishBatch 后查相册最新 is_video 条目的 lloc（封面定位符）。 */
async function fetchNewestVideoLloc(uin: string, gtk: number, cookieHeader: string, albumId: string): Promise<string | null> {
  const url = `https://user.qzone.qq.com/proxy/domain/plist.photo.qq.com/fcgi-bin/cgi_list_photo?g_tk=${gtk}&mode=0&idcNum=4&hostUin=${uin}&topicId=${albumId}&noTopic=0&uin=${uin}&pageStart=0&pageNum=3&appid=4&inCharset=utf-8&outCharset=utf-8&source=qzone&plat=qzone&outstyle=json&format=json&json_esc=1&r=${randomBytes(4).readUInt32BE(0)}`;
  try {
    const r = await fetch(url, { headers: { cookie: cookieHeader, referer: `https://user.qzone.qq.com/${uin}`, "user-agent": UA } });
    const j = (await r.json()) as any;
    const entry = (j?.data?.photoList || []).find((p: any) => p.is_video);
    return entry?.lloc || null;
  } catch {
    return null;
  }
}
