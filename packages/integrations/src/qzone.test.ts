import { describe, expect, test } from "bun:test";
import { parseQZoneEmotionMetricsPayload } from "./qzone";

describe("qzone emotion metric parsing (qz_opcnt2 appid=311 newdata)", () => {
  test("extracts like/view(PRD)/comment(CS)/forward(ZS) from newdata", () => {
    expect(
      parseQZoneEmotionMetricsPayload({
        code: 0,
        message: "succ",
        data: [
          {
            current: {
              key: "http://user.qzone.qq.com/123/mood/abc",
              cntdata: { act: 0, like: 324, share: 0, forward: 0 },
              newdata: { LIKE: 324, PRD: 4128, PVS: 6, CS: 14, ZS: 0 },
            },
          },
        ],
      }),
    ).toEqual({
      visitorCount: 4128,
      likeCount: 324,
      commentCount: 14,
      forwardCount: 0,
    });
  });

  test("visitorCount null when PRD missing", () => {
    expect(
      parseQZoneEmotionMetricsPayload({
        code: 0,
        data: [{ current: { newdata: { LIKE: 5, CS: 1, ZS: 0 } } }],
      }),
    ).toEqual({ visitorCount: null, likeCount: 5, commentCount: 1, forwardCount: 0 });
  });

  test("falls back to cntdata.like when newdata.LIKE absent", () => {
    expect(
      parseQZoneEmotionMetricsPayload({
        code: 0,
        data: [{ current: { cntdata: { like: 9, forward: 1, share: 2 }, newdata: { PRD: 100 } } }],
      }),
    ).toEqual({ visitorCount: 100, likeCount: 9, commentCount: 0, forwardCount: 3 });
  });

  test("throws on non-zero code (login error)", () => {
    expect(() => parseQZoneEmotionMetricsPayload({ code: -87998, message: "login error", data: [] })).toThrow("login error");
  });

  test("throws when newdata missing (appid=311 not sent)", () => {
    expect(() =>
      parseQZoneEmotionMetricsPayload({ code: 0, data: [{ current: { cntdata: { like: 1 } } }] }),
    ).toThrow("newdata");
  });
});
