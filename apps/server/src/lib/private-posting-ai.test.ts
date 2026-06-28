import { describe, expect, test } from "bun:test";
import { DEFAULT_PRIVATE_POST_PROMPT } from "@campux/domain";
import { buildPrivatePostSystemPrompt, fallbackAnalyzePrivatePostSemantics, normalizePrivatePostSemanticResult, parsePrivatePostSemanticJson } from "./private-posting-ai";

describe("private post AI semantic parsing", () => {
  test("parses standard JSON response", () => {
    expect(
      parsePrivatePostSemanticJson(JSON.stringify({
        intent: "post",
        action: "submit",
        text: "第一段\n第二段",
        anonymous: true,
        shouldSubmit: true,
        sections: ["第一段", "第二段"],
        confidence: 0.92,
        reason: "用户明确匿名提交",
      })),
    ).toEqual({
      intent: "post",
      action: "submit",
      text: "第一段\n第二段",
      anonymous: true,
      shouldSubmit: true,
      sections: ["第一段", "第二段"],
      confidence: 0.92,
      reason: "用户明确匿名提交",
      rawOutput: {
        intent: "post",
        action: "submit",
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

  test("normalizes casual crowd-question LLM post result back to chat", () => {
    const result = normalizePrivatePostSemanticResult(
      {
        intent: "post",
        action: "none",
        text: "好奇大家高考考的怎么样啊",
        anonymous: null,
        shouldSubmit: false,
        sections: ["好奇大家高考考的怎么样啊"],
        confidence: 0.86,
        reason: "LLM 误判为评价征集",
      },
      { messageText: "好奇大家高考考的怎么样啊", hasCurrentDraft: false, imageCount: 0 },
    );

    expect(result.intent).toBe("chat");
    expect(result.text).toBe("");
    expect(result.sections).toEqual([]);
    expect(result.shouldSubmit).toBe(false);
    expect(result.reason).toContain("casual_crowd_question");
  });

  test("normalization tolerates malformed missing reason", () => {
    const result = normalizePrivatePostSemanticResult(
      {
        intent: "post",
        action: "none",
        text: "好奇大家高考考的怎么样啊",
        anonymous: null,
        shouldSubmit: false,
        sections: ["好奇大家高考考的怎么样啊"],
        confidence: 0.86,
      } as never,
      { messageText: "好奇大家高考考的怎么样啊", hasCurrentDraft: false, imageCount: 0 },
    );

    expect(result.intent).toBe("chat");
    expect(result.reason).toBe("casual_crowd_question");
  });

  test("normalization keeps explicit post requests as post", () => {
    const result = normalizePrivatePostSemanticResult(
      {
        intent: "post",
        action: "submit",
        text: "今天食堂阿姨特别好",
        anonymous: true,
        shouldSubmit: true,
        sections: ["今天食堂阿姨特别好"],
        confidence: 0.92,
        reason: "明确要求匿名投稿",
      },
      { messageText: "帮我匿名投稿：今天食堂阿姨特别好", hasCurrentDraft: false, imageCount: 0 },
    );

    expect(result.intent).toBe("post");
    expect(result.text).toBe("今天食堂阿姨特别好");
    expect(result.anonymous).toBe(true);
    expect(result.shouldSubmit).toBe(true);
  });

  test("uses custom private post prompt as full system prompt", () => {
    const customPrompt = "请判断以下内容是否为校园墙稿件，只返回 JSON";
    const prompt = buildPrivatePostSystemPrompt(customPrompt);
    expect(prompt).toBe(customPrompt);
    expect(prompt).not.toContain("租户补充规则");
  });

  test("uses default prompt when custom private post prompt is blank", () => {
    const prompt = buildPrivatePostSystemPrompt("  \n  ");
    expect(prompt).toBe(DEFAULT_PRIVATE_POST_PROMPT);
    expect(prompt).toContain("校园墙 QQ 私聊投稿语义解析器");
    expect(prompt).toContain("action");
    expect(prompt).toContain("none|submit|cancel|undo");
    expect(prompt).toContain("不要用关键词表或单个词命中做判断");
    expect(prompt).toContain("是");
    expect(prompt).toContain("否");
    expect(prompt).toContain("稿件");
    expect(prompt).not.toContain("租户补充规则");
  });
});
