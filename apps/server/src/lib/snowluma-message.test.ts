import { describe, expect, test } from "bun:test";
import {
  extractOneBotImageSegments,
  extractOneBotMessageSegments,
  extractOneBotPlainText,
  splitCqStringSegment,
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

  test("段过滤：字符串段拆分后 face 等非文本段保留，空白 text 滤掉", () => {
    const segs = extractOneBotMessageSegments([
      "[CQ:face,id=1]",
      { type: "text", data: { content: "实际内容" } },
    ]);
    // face 会规范成非文本段（转发需要），纯空白 text 仍滤掉
    expect(segs.map((s) => s.type)).toEqual(["face", "text"]);
  });
});

describe("review fixes: CQ 字符串段与正文空白", () => {
  test("数组内裸字符串段也会剥离 CQ（review #2）", () => {
    const text = extractOneBotPlainText(["[CQ:at,qq=1] #投稿 字符串段"]).trim();
    expect(text).toBe("#投稿 字符串段");
    expect(parsePrivatePostStartText(text, { aiIntakeEnabled: true })).toBe("字符串段");
  });

  test("数组内字符串段里的 CQ:image 仍可提取（review #2）", () => {
    const segs = extractOneBotImageSegments(["[CQ:image,file=z.jpg]", { type: "image", data: { file: "a.jpg" } }]);
    expect(segs.length).toBe(2);
  });

  test("stripCqCodes 不压缩正文连续空白（review #3）", () => {
    expect(extractOneBotPlainText("[CQ:image,file=x.jpg]你好  世界")).toBe("你好  世界");
    expect(extractOneBotPlainText([{ type: "text", data: { text: "a  b\tc" } }])).toBe("a  b\tc");
  });
});

describe("自审修复：段类型规范化与图片顺序", () => {
  test("裸字符串段会被规范成 text 段，不再是裸 string", () => {
    const segs = extractOneBotMessageSegments(["[CQ:at,qq=1] #投稿 正文", { type: "image", data: { file: "a.jpg" } }]);
    expect(segs.every((s) => typeof s === "object" && typeof (s as { type?: string }).type === "string")).toBe(true);
    // 字符串段拆分后 at 是独立段，其后才是 text，再是对象 image
    expect(segs.map((s) => s.type)).toEqual(["at", "text", "image"]);
  });

  test("字符串段 CQ:image 与对象 image 段保持原始顺序", () => {
    const segs = extractOneBotImageSegments([
      { type: "image", data: { file: "first.jpg" } },
      "[CQ:image,file=second.jpg]",
      { type: "image", data: { file: "third.jpg" } },
    ]);
    expect(segs.map((s) => String(s.data?.file ?? s.data?.url ?? ""))).toEqual([
      "first.jpg",
      "second.jpg",
      "third.jpg",
    ]);
  });
});

describe("二审修复：字符串段拆分与撤回理由长度", () => {
  test("字符串段拆成 image+text，转发不丢图", () => {
    const segs = splitCqStringSegment("[CQ:image,file=a.jpg]正文");
    expect(segs).toEqual([
      { type: "image", data: { file: "a.jpg" } },
      { type: "text", data: { text: "正文" } },
    ]);
  });

  test("字符串段拆分保留 at/reply 等非图片段", () => {
    const segs = splitCqStringSegment("[CQ:at,qq=1] 你好");
    expect(segs[0]?.type).toBe("at");
    expect(segs[1]?.type).toBe("text");
  });

  test("extractOneBotMessageSegments 用拆分结果", () => {
    const segs = extractOneBotMessageSegments(["[CQ:image,file=x.jpg]看图"]);
    expect(segs.map((s) => s.type)).toEqual(["image", "text"]);
    expect(segs[1]?.data?.text).toBe("看图");
  });
});
