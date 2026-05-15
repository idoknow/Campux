import { Buffer } from "node:buffer";
import { encryptJson } from "./secret-json";
import { prisma } from "./prisma";
import { qzoneCookieDomain } from "./bot-workflows";

const qrcodeUrl = "https://ssl.ptlogin2.qq.com/ptqrshow?appid=549000912&e=2&l=M&s=3&d=72&v=4&t=0.31232733520361844&daid=5&pt_3rd_aid=0";
const loginCheckUrl =
  "https://xui.ptlogin2.qq.com/ssl/ptqrlogin?u1=https://qzs.qq.com/qzone/v5/loginsucc.html?para=izone&ptqrtoken={token}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-1656992258324&js_ver=22070111&js_type=1&pt_uistyle=40&aid=549000912&daid=5&has_onekey=1&&o1vId=1e61428d61cb5015701ad73d5fb59f73";
const checkSigUrl =
  "https://ptlogin2.qzone.qq.com/check_sig?pttype=1&uin={uin}&service=ptqrlogin&nodirect=1&ptsigx={ptsigx}&s_url=https://qzs.qq.com/qzone/v5/loginsucc.html?para=izone&f_url=&ptlang=2052&ptredirect=100&aid=549000912&daid=5&j_later=0&low_login_hour=0&regmaster=0&pt_login_type=3&pt_aid=0&pt_aaid=16&pt_light=0&pt_3rd_aid=0";

export type QZoneLoginStatus = "pending" | "succeeded" | "expired" | "failed";

type LoginTask = {
  id: string;
  botAccountId: string;
  tenantId: string;
  actorId: string | null;
  qrsig: string;
  token: string;
  qrImage: Buffer;
  status: QZoneLoginStatus;
  message: string | null;
  cookieNames: string[];
  createdAt: Date;
  expiresAt: Date;
};

const loginTasks = new Map<string, LoginTask>();

export async function startQZoneQrLogin({ botAccountId, tenantId, actorId }: { botAccountId: string; tenantId: string; actorId?: string | null }) {
  const response = await fetch(qrcodeUrl);
  if (!response.ok) {
    throw new Error(`获取 QZone 登录二维码失败：${response.status}`);
  }
  const setCookies = getSetCookieHeaders(response.headers);
  const qrsig = parseSetCookieHeaders(setCookies).qrsig;
  if (!qrsig) {
    throw new Error("QZone 登录二维码没有返回 qrsig");
  }
  const task: LoginTask = {
    id: crypto.randomUUID(),
    botAccountId,
    tenantId,
    actorId: actorId ?? null,
    qrsig,
    token: getPtQrToken(qrsig),
    qrImage: Buffer.from(await response.arrayBuffer()),
    status: "pending",
    message: null,
    cookieNames: [],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 120_000),
  };
  loginTasks.set(task.id, task);
  return serializeTask(task);
}

export async function pollQZoneQrLogin(taskId: string) {
  const task = loginTasks.get(taskId);
  if (!task) {
    throw new Error("登录任务不存在或已过期");
  }
  if (task.status !== "pending") {
    return serializeTask(task);
  }
  if (task.expiresAt.getTime() <= Date.now()) {
    task.status = "expired";
    task.message = "二维码已过期";
    return serializeTask(task);
  }

  const response = await fetch(loginCheckUrl.replace("{token}", task.token), {
    headers: {
      Cookie: `qrsig=${task.qrsig}`,
    },
  });
  const text = await response.text();
  if (text.includes("二维码已失效")) {
    task.status = "expired";
    task.message = "二维码已失效";
    return serializeTask(task);
  }
  if (!text.includes("登录成功")) {
    task.message = text.includes("二维码未失效") ? "等待扫码确认" : "等待登录确认";
    return serializeTask(task);
  }

  const callback = parsePtUiCallback(text);
  const url = callback[2] ?? "";
  const ptsigx = new URL(url).searchParams.get("ptsigx");
  const uin = new URL(url).searchParams.get("uin");
  if (!ptsigx || !uin) {
    task.status = "failed";
    task.message = "QZone 登录回调缺少必要参数";
    return serializeTask(task);
  }

  const loginCookies = parseSetCookieHeaders(getSetCookieHeaders(response.headers));
  const finalResponse = await fetch(checkSigUrl.replace("{uin}", uin).replace("{ptsigx}", ptsigx), {
    headers: {
      Cookie: cookieRecordToHeader({
        qrsig: task.qrsig,
        ...loginCookies,
      }),
    },
    redirect: "manual",
  });
  const cookies = parseSetCookieHeaders(getSetCookieHeaders(finalResponse.headers));
  if (!cookies.p_skey && !cookies.skey) {
    task.status = "failed";
    task.message = `扫码成功但没有拿到有效 QZone cookies（返回：${Object.keys(cookies).join(", ") || "无 cookies"}）`;
    return serializeTask(task);
  }

  const session = await prisma.botSession.upsert({
    where: {
      botAccountId_type_domain: {
        botAccountId: task.botAccountId,
        type: "qzone",
        domain: qzoneCookieDomain,
      },
    },
    update: {
      cookies: encryptJson(cookies),
      rawCookies: null,
      refreshedAt: new Date(),
      expiresAt: null,
      healthStatus: "unchecked",
      healthCheckedAt: null,
      healthMessage: "cookies 已刷新，等待可用性检测",
    },
    create: {
      botAccountId: task.botAccountId,
      type: "qzone",
      domain: qzoneCookieDomain,
      cookies: encryptJson(cookies),
      rawCookies: null,
      healthMessage: "cookies 已刷新，等待可用性检测",
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: task.tenantId,
      actorId: task.actorId,
      action: "bot.qzone.cookies.qr_login",
      targetType: "bot_session",
      targetId: session.id,
      detail: {
        cookieNames: Object.keys(cookies),
      },
    },
  });
  task.status = "succeeded";
  task.message = "登录完成";
  task.cookieNames = Object.keys(cookies);
  return serializeTask(task);
}

function serializeTask(task: LoginTask) {
  return {
    id: task.id,
    status: task.status,
    message: task.message,
    cookieNames: task.cookieNames,
    qrImage: `data:image/png;base64,${task.qrImage.toString("base64")}`,
    createdAt: task.createdAt.toISOString(),
    expiresAt: task.expiresAt.toISOString(),
  };
}

function getPtQrToken(qrsig: string) {
  let value = 0;
  for (let index = 0; index < qrsig.length; index += 1) {
    value += (value << 5) + qrsig.charCodeAt(index);
  }
  return String(2147483647 & value);
}

function parsePtUiCallback(text: string) {
  const payload = text.replace(/^ptuiCB\(/, "").replace(/\);?$/, "");
  return payload
    .split(",")
    .map((part) => part.trim().replace(/^'/, "").replace(/'$/, ""));
}

function getSetCookieHeaders(headers: Headers) {
  const maybeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const values = maybeHeaders.getSetCookie?.();
  if (values?.length) {
    return values;
  }
  const value = headers.get("set-cookie");
  return value ? splitCombinedSetCookieHeader(value) : [];
}

function splitCombinedSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[^=;,\s]+=)/).map((part) => part.trim()).filter(Boolean);
}

function parseSetCookieHeaders(values: string[]) {
  const cookies: Record<string, string> = {};
  for (const value of values) {
    const firstPart = value.split(";")[0]?.trim() ?? "";
    const [name, ...valueParts] = firstPart.split("=");
    const cookieValue = valueParts.join("=");
    if (name && cookieValue) {
      cookies[name] = cookieValue;
    }
  }
  return cookies;
}

function cookieRecordToHeader(cookies: Record<string, string | undefined>) {
  return Object.entries(cookies)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
