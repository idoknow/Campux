import { describe, expect, test } from "bun:test";
import { parseQZoneMsgDetailPayload, parseQZoneOpcntPayload } from "./qzone";

describe("qzone opcnt parsing (qz_opcnt2)", () => {
  test("extracts like and forward (forward + share) from cntdata", () => {
    expect(
      parseQZoneOpcntPayload({
        code: 0,
        message: "succ",
        data: [
          {
            current: {
              key: "http://user.qzone.qq.com/123/mood/abc",
              cntdata: { act: 0, like: 40, share: 2, forward: 3, retweet: 0 },
            },
          },
        ],
      }),
    ).toEqual({ likeCount: 40, forwardCount: 5 });
  });

  test("throws on non-zero code", () => {
    expect(() => parseQZoneOpcntPayload({ code: -87998, message: "login error", data: [] })).toThrow("login error");
  });

  test("throws when cntdata missing", () => {
    expect(() => parseQZoneOpcntPayload({ code: 0, data: [{ current: { key: "x" } }] })).toThrow("cntdata");
  });
});

describe("qzone msgdetail parsing (emotion_cgi_msgdetail_v6)", () => {
  test("extracts comment count from cmtnum and forward from fwdnum", () => {
    expect(parseQZoneMsgDetailPayload({ code: 0, cmtnum: 3, fwdnum: 1, total: 3, sum: 1 })).toEqual({
      commentCount: 3,
      forwardCount: 1,
    });
  });

  test("falls back to total when cmtnum absent", () => {
    expect(parseQZoneMsgDetailPayload({ code: 0, total: 2 })).toEqual({ commentCount: 2, forwardCount: 0 });
  });

  test("throws on non-zero code", () => {
    expect(() => parseQZoneMsgDetailPayload({ code: -10000, message: "no permission" })).toThrow("no permission");
  });
});
