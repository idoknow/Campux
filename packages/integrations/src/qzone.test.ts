import { describe, expect, test } from "bun:test";
import { buildPublishImageList, parseQZoneCommentList, parseQZoneEmotionMetricsPayload } from "./qzone";

describe("buildPublishImageList (batch multi-card ordering)", () => {
  const card1 = new Uint8Array([1]);
  const card2 = new Uint8Array([2]);
  const orig1 = { name: "o1.jpg", bytes: new Uint8Array([10]) };
  const orig2 = { name: "o2.jpg", bytes: new Uint8Array([20]) };

  test("orders all rendered cards first, then original images", () => {
    const result = buildPublishImageList([card1, card2], [orig1, orig2]);
    expect(result.map((image) => image.name)).toEqual([
      "rendered-card-1.jpg",
      "rendered-card-2.jpg",
      "o1.jpg",
      "o2.jpg",
    ]);
    expect(result[0].bytes).toBe(card1);
    expect(result[1].bytes).toBe(card2);
  });

  test("single card with no original images yields just the card", () => {
    expect(buildPublishImageList([card1]).map((image) => image.name)).toEqual(["rendered-card-1.jpg"]);
  });

  test("no cards (defensive) yields only original images", () => {
    expect(buildPublishImageList([], [orig1]).map((image) => image.name)).toEqual(["o1.jpg"]);
  });
});

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

  test("extracts image comments (empty content + pic[]/rich_info)", () => {
    const comments = parseQZoneCommentList({
      code: 0,
      commentlist: [
        {
          uin: 2206891648,
          name: "tear.",
          content: "",
          create_time: 1780204565,
          pic: [
            {
              b_url: "https://photogzmaz.photo.store.qq.com/psc?/big.jpg",
              o_url: "https://photogzmaz.photo.store.qq.com/psc?/orig.jpg",
              s_url: "https://photogzmaz.photo.store.qq.com/psc?/small.jpg",
            },
          ],
          rich_info: [{ burl: "https://photogzmaz.photo.store.qq.com/psc?/big.jpg", type: 1 }],
          list_3: [
            {
              uin: 1623746337,
              name: "好好学地理",
              content: "了解详情后继续添加就好了",
              create_time: 1780204862,
              pic: [{ b_url: "https://photogzmaz.photo.store.qq.com/psc?/reply.jpg" }],
            },
          ],
        },
      ],
    });
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe("");
    // 优先 b_url，并与 rich_info 去重。
    expect(comments[0].images).toEqual(["https://photogzmaz.photo.store.qq.com/psc?/big.jpg"]);
    expect(comments[0].replies[0].images).toEqual(["https://photogzmaz.photo.store.qq.com/psc?/reply.jpg"]);
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
