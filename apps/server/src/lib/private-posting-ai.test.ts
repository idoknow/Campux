import { describe, expect, test } from "bun:test";
import { fallbackAnalyzePrivatePostSemantics, parsePrivatePostSemanticJson } from "./private-posting-ai";

describe("private post AI semantic parsing", () => {
  test("parses standard JSON response", () => {
    expect(
      parsePrivatePostSemanticJson(JSON.stringify({
        intent: "post",
        text: "第一段\n第二段",
        anonymous: true,
        shouldSubmit: true,
        sections: ["第一段", "第二段"],
        confidence: 0.92,
        reason: "用户明确匿名提交",
      })),
    ).toEqual({
      intent: "post",
      text: "第一段\n第二段",
      anonymous: true,
      shouldSubmit: true,
      sections: ["第一段", "第二段"],
      confidence: 0.92,
      reason: "用户明确匿名提交",
      rawOutput: {
        intent: "post",
        text: "第一段\n第二段",
        anonymous: true,
        shouldSubmit: true,
        sections: ["第一段", "第二段"],
        confidence: 0.92,
        reason: "用户明确匿名提交",
      },
    });
  });

  test("accepts fenced JSON and clamps malformed confidence", () => {
    const parsed = parsePrivatePostSemanticJson('```json\n{"intent":"post","text":"内容","anonymous":false,"shouldSubmit":false,"confidence":2}\n```');
    expect(parsed?.confidence).toBe(1);
    expect(parsed?.anonymous).toBe(false);
    expect(parsed?.sections).toEqual(["内容"]);
  });

  test("fallback does not infer natural-language post intent without LLM", () => {
    const result = fallbackAnalyzePrivatePostSemantics({ messageText: "帮我匿名投稿：今天食堂阿姨特别好，可以直接发" });
    expect(result.intent).toBe("chat");
    expect(result.anonymous).toBe(null);
    expect(result.shouldSubmit).toBe(false);
    expect(result.text).toBe("");
    expect(result.reason).toBe("llm_unavailable");
  });

  test("fallback keeps ordinary chat with anonymity words out of post flow", () => {
    const result = fallbackAnalyzePrivatePostSemantics({ messageText: "我想匿名问一下怎么注册账号" });
    expect(result.intent).toBe("chat");
    expect(result.shouldSubmit).toBe(false);
  });

  test("fallback keeps ordinary chat out of post flow", () => {
    const result = fallbackAnalyzePrivatePostSemantics({ messageText: "你好，请问怎么注册账号" });
    expect(result.intent).toBe("chat");
    expect(result.shouldSubmit).toBe(false);
  });
});
