import { describe, expect, test } from "bun:test";
import {
  extractOneBotMessageSegments,
  extractOneBotPlainText,
  isPrivatePostCancelText,
  isPrivatePostUndoText,
  parsePostRecallOrCancelCommand,
  parsePrivatePostStartText,
} from "../lib/private-posting";
import { shouldRunPrivatePostKeywordCommand } from "./onebot";

/**
 * 议题 #162 #163 #164 的「复现用例」：
 * 这些用例对应用户反馈里的具体消息形态；修复前应失败，修复后应通过。
 */

describe("issue #163 复现：开启 AI 后 #投稿 指令仍应生效", () => {
  const aiOn = { extraKeywords: ["发帖", "吐槽"], aiIntakeEnabled: true };

  test("AI 开启时 #投稿 带正文仍能开稿", () => {
    // 修复前：parsePrivatePostStartText 在 aiIntakeEnabled 时直接 return null
    expect(parsePrivatePostStartText("#投稿 你好，世界", aiOn)).toBe("你好，世界");
    expect(parsePrivatePostStartText("＃投稿 你好，世界", aiOn)).toBe("你好，世界");
    expect(parsePrivatePostStartText("#投稿", aiOn)).toBe("");
  });

  test("AI 开启时自定义关键词仍能开稿", () => {
    expect(parsePrivatePostStartText("#发帖 今天好烦", aiOn)).toBe("今天好烦");
    expect(parsePrivatePostStartText("#吐槽 考试没考好", aiOn)).toBe("考试没考好");
  });

  test("AI 开启时草稿指令分支不被关掉", () => {
    // 修复前：shouldRunPrivatePostKeywordCommand(true) === false
    expect(shouldRunPrivatePostKeywordCommand(true)).toBe(true);
    expect(isPrivatePostCancelText("#取消")).toBe(true);
    expect(isPrivatePostUndoText("#撤回")).toBe(true);
  });

  test("自由文本仍不是显式开稿指令", () => {
    expect(parsePrivatePostStartText("我想投稿一条消息", aiOn)).toBeNull();
  });
});

describe("issue #162 复现：对话按编号取消/撤回", () => {
  test("用户反馈指令 #取消 123", () => {
    expect(parsePostRecallOrCancelCommand("#取消 123")).toEqual({
      action: "cancel",
      displayId: 123,
      reason: "",
    });
  });

  test("用户反馈指令 #撤回 <理由> 123", () => {
    expect(parsePostRecallOrCancelCommand("#撤回 发错人了 123")).toEqual({
      action: "recall",
      displayId: 123,
      reason: "发错人了",
    });
    expect(parsePostRecallOrCancelCommand("#撤回 内容有误 45")).toEqual({
      action: "recall",
      displayId: 45,
      reason: "内容有误",
    });
  });

  test("与草稿流无编号指令不冲突", () => {
    expect(parsePostRecallOrCancelCommand("#取消")).toBeNull();
    expect(parsePostRecallOrCancelCommand("#撤回")).toBeNull();
    expect(isPrivatePostCancelText("#取消")).toBe(true);
    expect(isPrivatePostUndoText("#撤回")).toBe(true);
    // 有编号时不应当作草稿撤销
    expect(isPrivatePostUndoText("#撤回 123")).toBe(false);
    expect(isPrivatePostCancelText("#取消 123")).toBe(false);
  });

  test("全角 # 与 #编号 写法", () => {
    expect(parsePostRecallOrCancelCommand("＃取消 8")).toEqual({
      action: "cancel",
      displayId: 8,
      reason: "",
    });
    expect(parsePostRecallOrCancelCommand("#撤回 #202")).toEqual({
      action: "recall",
      displayId: 202,
      reason: "",
    });
  });
});

describe("issue #164 复现：snowluma 消息形态", () => {
  test("data.content 文本段（snowluma 常见）", () => {
    const text = extractOneBotPlainText([
      { type: "text", data: { content: "#投稿 雪花客户端" } },
    ]);
    expect(text).toBe("#投稿 雪花客户端");
    expect(parsePrivatePostStartText(text.trim(), { aiIntakeEnabled: true })).toBe("雪花客户端");
    expect(parsePostRecallOrCancelCommand(text.replace("#投稿", "#撤回").trim() + "")).toBeNull();
    expect(parsePostRecallOrCancelCommand("#撤回 理由 33")).toEqual({
      action: "recall",
      displayId: 33,
      reason: "理由",
    });
  });

  test("字符串段数组", () => {
    expect(extractOneBotPlainText(["#取消 66"])).toContain("#取消 66");
    const parsed = parsePostRecallOrCancelCommand(extractOneBotPlainText(["#取消 66"]).trim());
    expect(parsed).toEqual({ action: "cancel", displayId: 66, reason: "" });
  });

  test("单对象 message 与 raw_message 回退", () => {
    expect(extractOneBotPlainText({ type: "text", data: { text: "hello" } })).toBe("hello");
    expect(extractOneBotPlainText([{ type: "image", data: { file: "a.jpg" } }], "[CQ:image,file=a.jpg]")).toContain("CQ:image");
  });

  test("段过滤仍能去掉空白 text 段", () => {
    const segs = extractOneBotMessageSegments([
      { type: "text", data: { content: "   " } },
      { type: "text", data: { content: "有效" } },
      "裸字符串",
    ]);
    expect(segs.length).toBe(2);
  });
});
