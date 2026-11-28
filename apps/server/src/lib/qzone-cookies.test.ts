import { afterEach, describe, expect, it } from "bun:test";
import { checkQZoneCookieHealth } from "./qzone-cookies";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(body: string, status = 200) {
  globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch;
}

const cookies = { p_skey: "test-p-skey", uin: "o123456" };

describe("checkQZoneCookieHealth", () => {
  it("marks available when code is 0 even without visitor counts", async () => {
    // 真实案例（NapCat 协议 cookies）：QZone 返回 {"code":0,"message":"succ"}，不带访客统计。
    // code 0 说明请求通过了登录校验，不能判失效，也不该停留在“未检测”。
    mockFetch(JSON.stringify({ code: 0, message: "succ" }));
    const result = await checkQZoneCookieHealth(cookies, "123456");
    expect(result.status).toBe("available");
    expect(result.visitorCounts).toBeUndefined();
    expect(result.message).toContain("succ");
  });

  it("marks available when visitor counts are present", async () => {
    mockFetch(JSON.stringify({ code: 0, message: "succ", data: { todaycount: 12, totalcount: 3456 } }));
    const result = await checkQZoneCookieHealth(cookies, "123456");
    expect(result.status).toBe("available");
    expect(result.visitorCounts).toEqual({ todayCount: 12, totalCount: 3456 });
  });

  it("marks invalid only on explicit login failure responses", async () => {
    mockFetch(`_Callback(${JSON.stringify({ code: -87998, message: "login error" })});`);
    const result = await checkQZoneCookieHealth(cookies, "123456");
    expect(result.status).toBe("invalid");
  });

  it("keeps non-login business errors transient", async () => {
    mockFetch(JSON.stringify({ code: -30001, message: "freq limit" }));
    const result = await checkQZoneCookieHealth(cookies, "123456");
    expect(result.status).toBe("transient");
  });

  it("treats HTTP failures as transient", async () => {
    mockFetch("gateway error", 503);
    const result = await checkQZoneCookieHealth(cookies, "123456");
    expect(result.status).toBe("transient");
  });

  it("marks invalid immediately when required cookies are missing", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const result = await checkQZoneCookieHealth({ uin: "123456" }, "123456");
    expect(result.status).toBe("invalid");
    expect(called).toBe(false);
  });
});
