import { describe, expect, test } from "bun:test";
import { parseQZoneCommentList, parseQZoneEmotionMetricsPayload } from "./qzone";

describe("qzone comment list parsing", () => {
  test("extracts commenter, content, time and nested replies (list_3)", () => {
    const comments = parseQZoneCommentList({
      code: 0,
      commentlist: [
        {
          uin: 2040347161,
          name: "攻玉",
          content: "在墙上发这种东西何意味[em]e402210[/em]",
          create_time: 1779608247,
          replyNum: 1,
          list_3: [
            {
              uin: 2777262813,
              name: "纯真FIN",
              content: "@{uin:3583282482,nick:合纵,who:1,auto:1}学到了",
              create_time: 1779615643,
            },
          ],
        },
      ],
    });
    expect(comments).toHaveLength(1);
    expect(comments[0].uin).toBe("2040347161");
    expect(comments[0].name).toBe("攻玉");
    expect(comments[0].content).toBe("在墙上发这种东西何意味[表情]");
    expect(comments[0].createdAt).toBe(new Date(1779608247 * 1000).toISOString());
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0].name).toBe("纯真FIN");
    expect(comments[0].replies[0].content).toBe("@合纵学到了");
  });

  test("returns empty array when no commentlist", () => {
    expect(parseQZoneCommentList({ code: 0 })).toEqual([]);
  });

  test("throws on non-zero code", () => {
    expect(() => parseQZoneCommentList({ code: -3000, message: "no permission" })).toThrow("no permission");
  });
});

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
