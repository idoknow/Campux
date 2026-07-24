import { describe, expect, test } from "bun:test";
import { decideCollectingBatchSweep, decideFlush, joinBatchCaptions, postImageCount } from "./publish-batching";

describe("decideCollectingBatchSweep", () => {
  const now = new Date("2026-07-24T00:00:00.000Z").getTime();

  test("flushes a non-empty collecting batch immediately after mode changes away from accumulate", () => {
    expect(decideCollectingBatchSweep({
      mode: "single",
      imageCount: 2,
      lastItemAt: new Date(now - 1_000),
      staleMinutes: 60,
      now,
    })).toBe("flush_mode_changed");
    expect(decideCollectingBatchSweep({
      mode: "single",
      imageCount: 2,
      lastItemAt: null,
      staleMinutes: 60,
      now,
    })).toBe("flush_mode_changed");
  });

  test("waits for a fresh accumulate batch and flushes it after the stale threshold", () => {
    expect(decideCollectingBatchSweep({
      mode: "accumulate",
      imageCount: 2,
      lastItemAt: new Date(now - 59 * 60_000),
      staleMinutes: 60,
      now,
    })).toBe("wait");
    expect(decideCollectingBatchSweep({
      mode: "accumulate",
      imageCount: 2,
      lastItemAt: new Date(now - 60 * 60_000),
      staleMinutes: 60,
      now,
    })).toBe("flush_stale");
  });

  test("does not flush empty batches", () => {
    expect(decideCollectingBatchSweep({
      mode: "single",
      imageCount: 0,
      lastItemAt: new Date(now - 24 * 60 * 60_000),
      staleMinutes: 60,
      now,
    })).toBe("wait");
  });
});

describe("joinBatchCaptions", () => {
  test("joins multiple captions with separator", () => {
    expect(joinBatchCaptions(["#12 hi", "#15 yo"])).toBe("#12 hi\n———\n#15 yo");
  });

  test("drops empty/whitespace captions", () => {
    expect(joinBatchCaptions(["#12", "", "  ", "#15"])).toBe("#12\n———\n#15");
  });

  test("single caption has no separator", () => {
    expect(joinBatchCaptions(["#12 only"])).toBe("#12 only");
  });

  test("all-empty yields empty string", () => {
    expect(joinBatchCaptions(["", "  "])).toBe("");
  });
});

describe("postImageCount", () => {
  test("text-only post = 1 (rendered card only)", () => {
    expect(postImageCount([])).toBe(1);
    expect(postImageCount(null)).toBe(1);
    expect(postImageCount(undefined)).toBe(1);
  });

  test("post with 3 attachments = 1 card + 3 = 4", () => {
    expect(postImageCount([{ key: "a" }, { key: "b" }, { key: "c" }])).toBe(4);
  });
});

describe("decideFlush (min=6, max=9)", () => {
  const min = 6;
  const max = 9;

  test("below min: wait", () => {
    // empty batch + a 1-image text post -> total 1 < 6
    expect(decideFlush(0, 1, min, max)).toEqual({ action: "wait" });
    // 5 accumulated + 1 -> still < 6? no, =6 -> flush. use 4+1=5
    expect(decideFlush(4, 1, min, max)).toEqual({ action: "wait" });
  });

  test("lands exactly in [min, max]: flush", () => {
    expect(decideFlush(5, 1, min, max)).toEqual({ action: "flush" }); // total 6
    expect(decideFlush(5, 4, min, max)).toEqual({ action: "flush" }); // total 9
    expect(decideFlush(0, 6, min, max)).toEqual({ action: "flush" }); // single post exactly 6
  });

  test("new post pushes over max while prev batch already >= min: flush old then start new", () => {
    // prev 7 (>=6), new post 5 -> total 12 > 9
    expect(decideFlush(7, 5, min, max)).toEqual({ action: "flush_then_start_new" });
    // prev 6, new 4 -> total 10 > 9
    expect(decideFlush(6, 4, min, max)).toEqual({ action: "flush_then_start_new" });
  });

  test("prev batch below min but new post tips over max: flush together (accept slight over-max)", () => {
    // prev 5 (<6), new 5 -> total 10 > 9, prev<min -> flush together
    expect(decideFlush(5, 5, min, max)).toEqual({ action: "flush" });
  });

  test("single oversize post (>max) on empty batch: flush_single_oversize", () => {
    // a post with 10 images on empty batch
    expect(decideFlush(0, 10, min, max)).toEqual({ action: "flush_single_oversize" });
  });

  test("single post exactly within range on empty batch flushes normally", () => {
    expect(decideFlush(0, 9, min, max)).toEqual({ action: "flush" });
    expect(decideFlush(0, 7, min, max)).toEqual({ action: "flush" });
  });

  test("min=max=1 edge: every post flushes immediately", () => {
    expect(decideFlush(0, 1, 1, 1)).toEqual({ action: "flush" });
  });
});
