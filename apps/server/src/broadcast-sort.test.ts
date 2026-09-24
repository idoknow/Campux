import { describe, expect, test } from "bun:test";
import { sortBroadcasts, type SortableBroadcast } from "./lib/broadcast-sort";

type BroadcastAuthor = { id: string; displayName: string | null; qqUin: bigint };
type BroadcastRow = SortableBroadcast & { author: BroadcastAuthor | null };

function make(id: string, count: number, modified: boolean, endsAtOffsetMs: number, createdAtOffsetMs = 0): BroadcastRow {
  return {
    id,
    endsAt: new Date(Date.now() + endsAtOffsetMs),
    broadcastCount: count,
    modified,
    createdAt: new Date(Date.now() + createdAtOffsetMs),
    author: { id: "u1", displayName: "测试", qqUin: 123456n },
  };
}

describe("sortBroadcasts 新通知三色排序", () => {
  test("未通知(红) → 已修改(橙) → 已通知(绿)", () => {
    const green = make("green", 3, false, 1000);
    const orange = make("orange", 2, true, 1000);
    const red = make("red", 0, false, 1000);
    expect(sortBroadcasts([green, orange, red], "active").map((item) => item.id)).toEqual([
      "red",
      "orange",
      "green",
    ]);
  });

  test("已修改且已广播多次仍是橙色，不被广播次数挤进绿色", () => {
    // 这是「点已广播后不该变红」的直接回归点：modified 优先级高于 broadcastCount。
    const orangeMany = make("orangeMany", 9, true, 1000);
    const greenFew = make("greenFew", 1, false, 2000);
    const red = make("red", 0, false, 3000);
    expect(sortBroadcasts([greenFew, orangeMany, red], "active").map((item) => item.id)).toEqual([
      "red",
      "orangeMany",
      "greenFew",
    ]);
  });

  test("同色组内按结束时间升序（快结束的排前面）", () => {
    const farRed = make("farRed", 0, false, 5000);
    const nearRed = make("nearRed", 0, false, 1000);
    const nearGreen = make("nearGreen", 2, false, 2000);
    const farGreen = make("farGreen", 1, false, 6000);
    expect(
      sortBroadcasts([farGreen, nearGreen, farRed, nearRed], "active").map((item) => item.id),
    ).toEqual(["nearRed", "farRed", "nearGreen", "farGreen"]);
  });

  test("不修改入参数组", () => {
    const input = [make("a", 1, false, 1000), make("b", 0, false, 1000)];
    const snapshot = input.map((item) => item.id);
    sortBroadcasts(input, "active");
    expect(input.map((item) => item.id)).toEqual(snapshot);
  });
});

describe("sortBroadcasts 历史通知排序", () => {
  test("按发出时间从新到旧", () => {
    const older = make("older", 1, false, -9000, -9000);
    const newer = make("newer", 2, false, -1000, -1000);
    const newest = make("newest", 3, true, -500, -500);
    expect(sortBroadcasts([older, newest, newer], "history").map((item) => item.id)).toEqual([
      "newest",
      "newer",
      "older",
    ]);
  });
});
