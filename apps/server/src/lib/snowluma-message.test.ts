import { describe, expect, test } from "bun:test";
import {
  extractOneBotImageSegments,
  extractOneBotMessageSegments,
  extractOneBotPlainText,
  parsePostRecallOrCancelCommand,
  parsePrivatePostStartText,
  isPrivatePostCancelText,
} from "../lib/private-posting";

/**
 * snowluma 同时支持「段数组」和「CQ 码字符串」两种 message 形态。
 * 这里两套都测，防止只适配数组又在 CQ 模式复现（议题 #164）。
 */

describe("snowluma 段数组形态", () => {
  test("text/data.text 与 data.content", () => {
    expect(extractOneBotPlainText([{ type: "text", data: { text: "#投稿 数组形态" } }])).toBe("#投稿 数组形态");
    expect(extractOneBotPlainText([{ type: "text", data: { content: "#取消 12" } }])).toBe("#取消 12");
  });

  test("image 段可提取", () => {
    const segs = extractOneBotImageSegments([
      { type: "text", data: { text: "看图" } },
      { type: "image", data: { file: "a.jpg", url: "http://x/a.jpg" } },
    ]);
    expect(segs.length).toBe(1);
    expect(segs[0]?.type).toBe("image");
  });

  test("命令解析正常", () => {
    const text = extractOneBotPlainText([{ type: "text", data: { text: "#撤回 内容错了 23" } }]).trim();
    expect(parsePostRecallOrCancelCommand(text)).toEqual({
      action: "recall",
      displayId: 23,
      reason: "内容错了",
    });
  });
});

describe("snowluma CQ 码字符串形态", () => {
  test("CQ:at 前缀后跟 #投稿 仍可开稿", () => {
    // 修复前：extract 原样返回带 CQ 的字符串，startsWith('#投稿') 失败
    const text = extractOneBotPlainText("[CQ:at,qq=10001] #投稿 雪花CQ形态").trim();
    expect(text).toBe("#投稿 雪花CQ形态");
    expect(parsePrivatePostStartText(text, { aiIntakeEnabled: true })).toBe("雪花CQ形态");
  });

  test("CQ:image 夹杂时正文仍是纯文本", () => {
    const text = extractOneBotPlainText("[CQ:image,file=a.jpg]#投稿 带图正文").trim();
    expect(parsePrivatePostStartText(text, { aiIntakeEnabled: true })).toBe("带图正文");
  });

  test("CQ 消息里的 #取消 / #撤回 指令", () => {
    const t1 = extractOneBotPlainText("[CQ:reply,id=9][CQ:at,qq=2]#取消 88").trim();
    expect(parsePostRecallOrCancelCommand(t1)).toEqual({ action: "cancel", displayId: 88, reason: "" });
    const t2 = extractOneBotPlainText("[CQ:face,id=178]#撤回 发错了 99").trim();
    expect(parsePostRecallOrCancelCommand(t2)).toEqual({
      action: "recall",
      displayId: 99,
      reason: "发错了",
    });
  });

  test("CQ 字符串可提取 image 段", () => {
    const segs = extractOneBotImageSegments("[CQ:image,file=b.jpg,url=http://x/b.jpg]");
    expect(segs.length).toBe(1);
    expect(segs[0]?.type).toBe("image");
    expect(String(segs[0]?.data?.file ?? segs[0]?.data?.url ?? "")).toContain("b.jpg");
  });

  test("CQ 仅表情时文本为空，不误触投稿", () => {
    const text = extractOneBotPlainText("[CQ:face,id=1]").trim();
    expect(text).toBe("");
    expect(parsePrivatePostStartText(text, { aiIntakeEnabled: true })).toBeNull();
    expect(isPrivatePostCancelText(text)).toBe(false);
  });

  test("raw_message 作为 CQ 兜底", () => {
    const text = extractOneBotPlainText(undefined, "[CQ:at,qq=1]＃撤回 7").trim();
    expect(parsePostRecallOrCancelCommand(text)).toEqual({ action: "recall", displayId: 7, reason: "" });
  });

  test("段过滤：字符串段里的 CQ-only 不进转发正文", () => {
    const segs = extractOneBotMessageSegments([
      "[CQ:face,id=1]",
      { type: "text", data: { content: "实际内容" } },
    ]);
    // 字符串段若只是 CQ 码应被滤掉；纯文本段保留
    expect(segs.length).toBe(1);
  });
});
