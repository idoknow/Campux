import { describe, expect, test } from "bun:test";
import { DEFAULT_PRIVATE_POST_KEYWORDS, extractOneBotImageSegments, extractOneBotPlainText, findPrivatePostKeywordMatch, isPrivatePostCancelText, isPrivatePostFinishText, isPrivatePostUndoText, matchPrivatePostKeywords, normalizePrivatePostKeywords, parsePostRecallOrCancelCommand, parsePrivatePostModeText, parsePrivatePostStartText } from "./private-posting";

describe("private posting command parsing", () => {
  test("parses English hash start command", () => {
    expect(parsePrivatePostStartText("#投稿 你好，世界")).toBe("你好，世界");
  });

  test("parses Chinese hash start command", () => {
    expect(parsePrivatePostStartText("＃投稿 你好，世界")).toBe("你好，世界");
  });

  test("accepts start command without a body", () => {
    expect(parsePrivatePostStartText("#投稿")).toBe("");
  });

  test("detects finish command with either hash", () => {
    expect(isPrivatePostFinishText("#结束")).toBe(true);
    expect(isPrivatePostFinishText("＃结束")).toBe(true);
    expect(isPrivatePostFinishText("#结束投稿")).toBe(true);
    expect(isPrivatePostFinishText("＃结束投稿")).toBe(true);
    expect(isPrivatePostFinishText("#结束投稿  ")).toBe(true);
  });

  test("detects cancel command with either hash", () => {
    expect(isPrivatePostCancelText("#取消")).toBe(true);
    expect(isPrivatePostCancelText("＃取消")).toBe(true);
    expect(isPrivatePostCancelText("#取消本次投稿")).toBe(true);
    expect(isPrivatePostCancelText("＃取消本次投稿")).toBe(true);
  });

  test("detects undo command with either hash", () => {
    expect(isPrivatePostUndoText("#撤回")).toBe(true);
    expect(isPrivatePostUndoText("＃撤回上一条")).toBe(true);
    expect(isPrivatePostUndoText("#撤回上一步  ")).toBe(true);
  });

  test("detects anonymous and real-name replies", () => {
    expect(parsePrivatePostModeText("#匿名")).toEqual({ anonymous: true });
    expect(parsePrivatePostModeText("＃匿名投稿")).toEqual({ anonymous: true });
    expect(parsePrivatePostModeText("#实名")).toEqual({ anonymous: false });
    expect(parsePrivatePostModeText("＃实名投稿")).toEqual({ anonymous: false });
    expect(parsePrivatePostModeText("匿名")).toBeNull();
    expect(parsePrivatePostModeText("实名")).toBeNull();
  });

  test("does not treat ordinary text as undo command", () => {
    expect(isPrivatePostUndoText("撤回")).toBe(false);
    expect(isPrivatePostUndoText("#撤回一下")).toBe(false);
  });

  test("accepts extra trigger keywords", () => {
    const extra = ["发帖", "吐槽", "表白"];
    expect(parsePrivatePostStartText("#发帖 你好", extra)).toBe("你好");
    expect(parsePrivatePostStartText("＃发帖 你好", extra)).toBe("你好");
    expect(parsePrivatePostStartText("#吐槽 今天好烦", extra)).toBe("今天好烦");
    expect(parsePrivatePostStartText("#表白 隔壁班的同学", extra)).toBe("隔壁班的同学");
    expect(parsePrivatePostStartText("#发帖", extra)).toBe("");
  });

  test("extra keywords never override default #投稿", () => {
    expect(parsePrivatePostStartText("#投稿 正文", [])).toBe("正文");
    expect(parsePrivatePostStartText("＃投稿 正文", undefined)).toBe("正文");
    expect(parsePrivatePostStartText("#投稿", ["发帖"])).toBe("");
  });

  test("disables start commands when AI intake is enabled", () => {
    const options = { extraKeywords: ["发帖"], aiIntakeEnabled: true };
    expect(parsePrivatePostStartText("#投稿 正文", options)).toBeNull();
    expect(parsePrivatePostStartText("＃投稿 正文", options)).toBeNull();
    expect(parsePrivatePostStartText("#发帖 正文", options)).toBeNull();
    expect(parsePrivatePostStartText("投稿", options)).toBeNull();
    expect(parsePrivatePostStartText("墙墙投稿", options)).toBeNull();
  });

  test("keeps start commands enabled when AI intake is disabled", () => {
    const options = { extraKeywords: ["发帖"], aiIntakeEnabled: false };
    expect(parsePrivatePostStartText("#投稿 正文", options)).toBe("正文");
    expect(parsePrivatePostStartText("#发帖 正文", options)).toBe("正文");
    expect(parsePrivatePostStartText("投稿", options)).toBe("");
  });

  test("does not match extra keywords when input has no matching prefix", () => {
    expect(parsePrivatePostStartText("发帖", ["发帖"])).toBeNull();
    expect(parsePrivatePostStartText("随便说点什么", ["发帖", "吐槽"])).toBeNull();
    expect(parsePrivatePostStartText("#其他命令", ["发帖"])).toBeNull();
  });
});

describe("onebot message helpers", () => {
  test("extracts plain text from onebot segments", () => {
    expect(
      extractOneBotPlainText([
        { type: "text", data: { text: "#投稿 " } },
        { type: "image", data: { file: "base64://abc" } },
        { type: "text", data: { text: "正文" } },
      ]),
    ).toBe("#投稿 \n正文");
  });

  test("extracts image segments only", () => {
    expect(
      extractOneBotImageSegments([
        { type: "text", data: { text: "hello" } },
        { type: "image", data: { file: "base64://abc" } },
        { type: "image", data: { url: "https://example.com/a.png" } },
      ]),
    ).toHaveLength(2);
  });
});

describe("parsePostRecallOrCancelCommand (issue 162)", () => {
  test("parses cancel by display id", () => {
    expect(parsePostRecallOrCancelCommand("#取消 123")).toEqual({ action: "cancel", displayId: 123, reason: "" });
    expect(parsePostRecallOrCancelCommand("#取消 #123")).toEqual({ action: "cancel", displayId: 123, reason: "" });
    expect(parsePostRecallOrCancelCommand("#取消投稿 45")).toEqual({ action: "cancel", displayId: 45, reason: "" });
  });

  test("parses recall with optional reason", () => {
    expect(parsePostRecallOrCancelCommand("#撤回 9")).toEqual({ action: "recall", displayId: 9, reason: "" });
    expect(parsePostRecallOrCancelCommand("#撤回 内容有误 10")).toEqual({ action: "recall", displayId: 10, reason: "内容有误" });
    expect(parsePostRecallOrCancelCommand("#撤回 发错了 202")).toEqual({ action: "recall", displayId: 202, reason: "发错了" });
    expect(parsePostRecallOrCancelCommand("#撤销 7")).toEqual({ action: "recall", displayId: 7, reason: "" });
  });

  test("rejects draft-only commands without display id", () => {
    expect(parsePostRecallOrCancelCommand("#取消")).toBeNull();
    expect(parsePostRecallOrCancelCommand("#撤回")).toBeNull();
    expect(parsePostRecallOrCancelCommand("#撤回上一条")).toBeNull();
    expect(parsePostRecallOrCancelCommand("#结束")).toBeNull();
  });

  test("rejects when trailing token is not a numeric id", () => {
    expect(parsePostRecallOrCancelCommand("#撤回 有误")).toBeNull();
  });
});

describe("bare private post keywords", () => {
  test("defaults let users start without a # prefix", () => {
    expect(matchPrivatePostKeywords("投稿 今天食堂")).toEqual([{ name: "start", body: "今天食堂" }]);
    expect(matchPrivatePostKeywords("表白 隔壁班的猫")).toEqual([{ name: "start", body: "隔壁班的猫" }]);
    expect(matchPrivatePostKeywords("墙墙投稿")).toEqual([{ name: "start", body: "" }]);
    expect(matchPrivatePostKeywords("＃投稿 带井号也认")).toEqual([{ name: "start", body: "带井号也认" }]);
  });

  test("longest keyword wins so 墙墙投稿 is not read as 墙 + 投稿", () => {
    expect(matchPrivatePostKeywords("墙墙投稿 你好")).toEqual([{ name: "start", body: "你好" }]);
  });

  test("ordinary sentences are not commands", () => {
    expect(matchPrivatePostKeywords("投稿箱在哪")).toEqual([]);
    expect(matchPrivatePostKeywords("墙裂推荐这家店")).toEqual([]);
    expect(matchPrivatePostKeywords("今天天气不错")).toEqual([]);
    expect(matchPrivatePostKeywords("确认一下")).toEqual([]);
  });

  test("control keywords ignore trailing punctuation", () => {
    expect(matchPrivatePostKeywords("算了。")).toEqual([{ name: "cancel" }]);
    expect(matchPrivatePostKeywords("结束！")).toEqual([{ name: "finish" }]);
    expect(matchPrivatePostKeywords("确认。")).toEqual([{ name: "confirm" }]);
    expect(matchPrivatePostKeywords("匿名")).toEqual([{ name: "anonymous" }]);
    expect(matchPrivatePostKeywords("不匿名")).toEqual([{ name: "realname" }]);
  });

  test("admin overrides replace defaults and empty lists disable a group", () => {
    const custom = normalizePrivatePostKeywords({ start: ["投个稿", "墙墙来稿"], cancel: [] });

    expect(custom.start).toEqual(["投个稿", "墙墙来稿"]);
    expect(custom.cancel).toEqual([]);
    expect(custom.finish).toEqual(DEFAULT_PRIVATE_POST_KEYWORDS.finish);
    expect(matchPrivatePostKeywords("投个稿 你好", custom)).toEqual([{ name: "start", body: "你好" }]);
    expect(matchPrivatePostKeywords("投稿 你好", custom)).toEqual([]);
    expect(matchPrivatePostKeywords("算了", custom)).toEqual([]);
  });

  test("normalizes hashes and duplicates", () => {
    const normalized = normalizePrivatePostKeywords({ start: ["#投稿", "投#稿", "投稿"], confirm: ["#发吧"] });

    expect(normalized.start).toEqual(["投稿", "投#稿"]);
    expect(normalized.confirm).toEqual(["发吧"]);
  });

  test("findPrivatePostKeywordMatch picks by name", () => {
    const matches = matchPrivatePostKeywords("结束");

    expect(findPrivatePostKeywordMatch(matches, "finish")?.name).toBe("finish");
    expect(findPrivatePostKeywordMatch(matches, "confirm")).toBeUndefined();
  });
});

describe("extractOneBotPlainText snowluma compatibility (issue 164)", () => {
  test("reads text from data.content as well as data.text", () => {
    expect(extractOneBotPlainText([{ type: "text", data: { content: "你好" } }])).toBe("你好");
    expect(extractOneBotPlainText([{ type: "text", data: { text: "你好" } }])).toBe("你好");
  });

  test("accepts bare string segments and single text object", () => {
    expect(extractOneBotPlainText(["你好", "世界"])).toContain("你好");
    expect(extractOneBotPlainText({ type: "text", data: { text: "hi" } })).toBe("hi");
  });

  test("falls back to raw_message when no text segment", () => {
    expect(extractOneBotPlainText([{ type: "image", data: { file: "x" } }], "[CQ:image,file=x]")).toBe("");
    expect(extractOneBotPlainText(undefined, "raw")).toBe("raw");
  });
});
