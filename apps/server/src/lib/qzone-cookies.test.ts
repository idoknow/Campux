import { describe, expect, test } from "bun:test";
import { checkQZoneCookieHealth } from "./qzone-cookies";

const originalFetch = globalThis.fetch;

function stubQZoneResponse(body: string, status = 200) {
  globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch;
}

const cookies = { p_skey: "test-p-skey", uin: "o10000" };

describe("checkQZoneCookieHealth", () => {
  test("parses visitor counts from a successful payload", async () => {
    stubQZoneResponse(`_Callback({"code":0,"message":"succ","data":{"todaycount":3,"totalcount":42}});`);
    const result = await checkQZoneCookieHealth(cookies, "10000");
    expect(result.status).toBe("available");
    expect(result.message).toContain("今日访客 3");
  });

  test("treats success without visitor data as transient, not invalid", async () => {
    // 线上实测：QZone 返回 code 0 / message "succ" 但 data 里没有访客字段，
    // 登录态是好的，判为 invalid 会触发无意义的刷新-告警循环。
    stubQZoneResponse(`_Callback({"code":0,"message":"succ","data":{}});`);
    const result = await checkQZoneCookieHealth(cookies, "10000");
    expect(result.status).toBe("transient");
    expect(result.message).toContain("返回成功但没有访客数据");
    expect(result.message).toContain("succ");
  });

  test("marks login failure signatures as invalid", async () => {
    stubQZoneResponse(`_Callback({"code":-87998,"message":"login error"});`);
    const result = await checkQZoneCookieHealth(cookies, "10000");
    expect(result.status).toBe("invalid");
    expect(result.message).toBe("login error");
  });

  test("treats non-zero business errors as transient", async () => {
    stubQZoneResponse(`_Callback({"code":300001,"message":"too many requests"});`);
    const result = await checkQZoneCookieHealth(cookies, "10000");
    expect(result.status).toBe("transient");
    expect(result.message).toContain("业务错误码 300001");
  });

  test("treats unparseable bodies as transient", async () => {
    stubQZoneResponse(`<html>please login</html>`);
    const result = await checkQZoneCookieHealth(cookies, "10000");
    expect(result.status).toBe("transient");
  });

  test("reports missing p_skey as invalid without calling QZone", async () => {
    stubQZoneResponse(`_Callback({"code":0,"message":"succ"});`);
    const result = await checkQZoneCookieHealth({ uin: "o10000" }, "10000");
    expect(result.status).toBe("invalid");
    expect(result.message).toContain("缺少 p_skey");
  });
});
