import { describe, expect, test } from "bun:test";
import { parseQZoneEmotionMetricsPayload } from "./qzone";

describe("qzone emotion metric parsing", () => {
  test("extracts counts from qz_opcnt2 newdata pairs", () => {
    expect(
      parseQZoneEmotionMetricsPayload({
        data: [
          {
            current: {
              newdata: [
                ["LIKE", 12],
                ["PRD", "34"],
                ["CS", 5],
                ["ZS", 6],
              ],
            },
          },
        ],
      }),
    ).toEqual({
      likeCount: 12,
      visitorCount: 34,
      commentCount: 5,
      forwardCount: 6,
    });
  });

  test("rejects payloads without qzone metric keys", () => {
    expect(() =>
      parseQZoneEmotionMetricsPayload({
        data: [
          {
            current: {
              newdata: [["OTHER", 1]],
            },
          },
        ],
      }),
    ).toThrow("LIKE/PRD/CS/ZS");
  });
});
