import { describe, expect, test } from "bun:test";

import { parsePrivatePostConfirmText } from "../lib/private-posting";
import {
  isPrivatePostAiIntakeActive,
  shouldAppendPrivatePostContentForSemantic,
  shouldApplyPrivatePostSemanticText,
  shouldConfirmPrivatePostSubmissionFromSemantic,
  shouldNotifyReviewGroupAfterPrivatePostCreate,
  shouldRunPrivatePostKeywordCommand,
  shouldSubmitPrivatePostAfterModeSelection,
  parseBanCommandArgs,
  parseCommand,
  parseReviewGroupCommand,
  parseUnbanCommandArgs,
  resolvePrivatePostModeSelectionFromSemantic,
  resolvePrivatePostSemanticAction,
} from "./onebot";

describe("parseCommand prefix handling", () => {
  test("解析半角 # 命令", () => {
    expect(parseCommand("#通过 123")).toEqual({ name: "通过", args: "123" });
  });

  test("解析全角 ＃ 命令（中文输入法常见，修复 #100）", () => {
    expect(parseCommand("＃通过 123")).toEqual({ name: "通过", args: "123" });
  });

  test("全角 ＃ 拒绝命令带理由与稿件号", () => {
    expect(parseCommand("＃拒绝 内容违规 456")).toEqual({ name: "拒绝", args: "内容违规 456" });
  });

  test("解析 / 命令前缀", () => {
    expect(parseCommand("/注册账号")).toEqual({ name: "注册账号", args: "" });
  });

  test("@ 机器人后跟全角命令仍可识别", () => {
    expect(parseCommand("[CQ:at,qq=10000] ＃通过 789")).toEqual({ name: "通过", args: "789" });
  });

  test("非命令文本返回 null", () => {
    expect(parseCommand("你好啊")).toBeNull();
  });

  test("命令前有非 @ 文本时不识别", () => {
    expect(parseCommand("随便说点什么 ＃通过 1")).toBeNull();
  });
});

describe("review group ban command parsing", () => {
  test("解析封禁参数中的 QQ 与理由", () => {
    expect(parseBanCommandArgs("123456789 刷屏广告")).toEqual({ qqUin: "123456789", reason: "刷屏广告" });
  });

  test("封禁理由可以包含空格", () => {
    expect(parseBanCommandArgs("123456789 多次 发布 广告")).toEqual({ qqUin: "123456789", reason: "多次 发布 广告" });
  });

  test("封禁参数缺少理由时返回 null", () => {
    expect(parseBanCommandArgs("123456789")).toBeNull();
  });

  test("解析解封参数中的 QQ", () => {
    expect(parseUnbanCommandArgs("123456789")).toEqual({ qqUin: "123456789" });
  });

  test("解封参数包含额外内容时返回 null", () => {
    expect(parseUnbanCommandArgs("123456789 其他内容")).toBeNull();
  });

  test("解析全部通过命令", () => {
    expect(parseReviewGroupCommand("#全部通过")).toEqual({ name: "全部通过", args: "" });
    expect(parseReviewGroupCommand("＃全部通过")).toEqual({ name: "全部通过", args: "" });
  });

  test("裸 ban/unban 不在通用解析中识别", () => {
    expect(parseCommand("ban 123456789 刷屏广告")).toBeNull();
    expect(parseCommand("unban 123456789")).toBeNull();
  });

  test("审核群解析支持裸 ban/unban 命令", () => {
    expect(parseReviewGroupCommand("ban 123456789 刷屏广告")).toEqual({ name: "ban", args: "123456789 刷屏广告" });
    expect(parseReviewGroupCommand("unban 123456789")).toEqual({ name: "unban", args: "123456789" });
  });

  test("审核群裸命令复用 CQ at 规范化", () => {
    expect(parseReviewGroupCommand("[CQ:at,qq=10000] ban 123456789 刷屏广告")).toEqual({ name: "ban", args: "123456789 刷屏广告" });
  });
});

describe("private post semantic mode selection", () => {
  test("非 AI 确认提交阶段只接受 #确认 或 #取消", () => {
    expect(parsePrivatePostConfirmText("#确认")).toEqual({ confirmed: true });
    expect(parsePrivatePostConfirmText("＃确认")).toEqual({ confirmed: true });
    expect(parsePrivatePostConfirmText("#取消")).toEqual({ confirmed: false });
    expect(parsePrivatePostConfirmText("确认")).toBeNull();
    expect(parsePrivatePostConfirmText("可以提交")).toBeNull();
  });

  test("AI 确认提交阶段使用语义确认或取消", () => {
    expect(shouldConfirmPrivatePostSubmissionFromSemantic({
      intent: "command",
      action: "submit",
      text: "正文",
      anonymous: null,
      shouldSubmit: true,
      sections: ["正文"],
      confidence: 0.9,
      reason: "用户用‘发布吧’表达确认提交",
    })).toEqual({ confirmed: true });

    expect(shouldConfirmPrivatePostSubmissionFromSemantic({
      intent: "command",
      action: "cancel",
      text: "正文",
      anonymous: null,
      shouldSubmit: false,
      sections: ["正文"],
      confidence: 0.85,
      reason: "用户取消投稿",
    })).toEqual({ confirmed: false });
  });

  test("AI 草稿阶段普通内容应追加正文，不因语义非 post 被丢弃", () => {
    expect(shouldAppendPrivatePostContentForSemantic({
      intent: "chat",
      action: "none",
      text: "补充一句",
      anonymous: null,
      shouldSubmit: false,
      sections: ["补充一句"],
      confidence: 0.7,
      reason: "用户继续补充内容",
    })).toBe(true);

    expect(shouldAppendPrivatePostContentForSemantic({
      intent: "command",
      action: "undo",
      text: "",
      anonymous: null,
      shouldSubmit: false,
      sections: [],
      confidence: 0.86,
      reason: "用户要求撤回",
    })).toBe(false);
  });

  test("AI 收稿不把低可用性下的命令式语义追加为正文", () => {
    expect(shouldAppendPrivatePostContentForSemantic({
      intent: "command",
      action: "none",
      text: "#取消",
      anonymous: null,
      shouldSubmit: false,
      sections: ["#取消"],
      confidence: 0.4,
      reason: "command_like_without_llm",
    })).toBe(false);
  });

  test("AI 收稿开启时禁用投稿关键词指令分支", () => {
    expect(shouldRunPrivatePostKeywordCommand(true)).toBe(false);
    expect(shouldRunPrivatePostKeywordCommand(false)).toBe(true);
  });

  test("AI 收稿通过语义 action 触发投稿草稿动作", () => {
    expect(resolvePrivatePostSemanticAction({
      intent: "command",
      action: "cancel",
      text: "",
      anonymous: null,
      shouldSubmit: false,
      sections: [],
      confidence: 0.86,
      reason: "用户想取消本次投稿",
    })).toBe("cancel");
    expect(resolvePrivatePostSemanticAction({
      intent: "command",
      action: "undo",
      text: "",
      anonymous: null,
      shouldSubmit: false,
      sections: [],
      confidence: 0.82,
      reason: "用户想撤回上一条内容",
    })).toBe("undo");
    expect(resolvePrivatePostSemanticAction({
      intent: "post",
      action: "submit",
      text: "最终正文",
      anonymous: true,
      shouldSubmit: true,
      sections: ["最终正文"],
      confidence: 0.9,
      reason: "用户表达完成并提交",
    })).toBe("submit");
  });

  test("AI 语义提交动作不把提交话术追加或覆盖正文", () => {
    const commandSubmit = {
      intent: "command" as const,
      action: "submit" as const,
      text: "可以提交",
      anonymous: null,
      shouldSubmit: true,
      sections: ["原稿"],
      confidence: 0.86,
      reason: "用户只是要求提交",
    };
    expect(shouldAppendPrivatePostContentForSemantic(commandSubmit)).toBe(false);
    expect(shouldApplyPrivatePostSemanticText(commandSubmit)).toBe(false);

    const postSubmit = {
      intent: "post" as const,
      action: "submit" as const,
      text: "原稿\n补充一句正文",
      anonymous: null,
      shouldSubmit: true,
      sections: ["原稿", "补充一句正文"],
      confidence: 0.86,
      reason: "用户补充正文后要求提交",
    };
    expect(shouldAppendPrivatePostContentForSemantic(postSubmit)).toBe(true);
    expect(shouldApplyPrivatePostSemanticText(postSubmit)).toBe(true);
  });

  test("AI 收稿忽略低置信度或无动作语义结果", () => {
    expect(resolvePrivatePostSemanticAction({
      intent: "command",
      action: "cancel",
      text: "",
      anonymous: null,
      shouldSubmit: false,
      sections: [],
      confidence: 0.39,
      reason: "低置信度",
    })).toBeNull();
    expect(resolvePrivatePostSemanticAction({
      intent: "chat",
      action: "none",
      text: "",
      anonymous: null,
      shouldSubmit: false,
      sections: [],
      confidence: 0.9,
      reason: "闲聊",
    })).toBeNull();
  });

  test("pending 模式采纳 AI 对是/否语义选择，不依赖关键词命令", () => {
    expect(resolvePrivatePostModeSelectionFromSemantic({
      intent: "command",
      action: "none",
      text: "原稿",
      anonymous: true,
      shouldSubmit: false,
      sections: ["原稿"],
      confidence: 0.8,
      reason: "用户回答是，表示同意匿名",
    })).toEqual({ anonymous: true });

    expect(resolvePrivatePostModeSelectionFromSemantic({
      intent: "command",
      action: "none",
      text: "原稿",
      anonymous: false,
      shouldSubmit: false,
      sections: ["原稿"],
      confidence: 0.8,
      reason: "用户回答否，表示不匿名",
    })).toEqual({ anonymous: false });
  });

  test("pending 模式优先采纳匿名选择，即使同时表达提交", () => {
    const semantic = {
      intent: "command" as const,
      action: "submit" as const,
      text: "原稿",
      anonymous: true,
      shouldSubmit: true,
      sections: ["原稿"],
      confidence: 0.88,
      reason: "用户表示匿名并提交",
    };

    expect(resolvePrivatePostModeSelectionFromSemantic(semantic)).toEqual({ anonymous: true });
    expect(resolvePrivatePostSemanticAction(semantic)).toBe("submit");
  });

  test("AI 已识别投稿但匿名未知时，选完匿名后应直接提交", () => {
    expect(shouldSubmitPrivatePostAfterModeSelection({
      intent: "post",
      action: "none",
      text: "我想问一下食堂的菜好不好吃\n有多少菜",
      anonymous: null,
      shouldSubmit: false,
      sections: ["我想问一下食堂的菜好不好吃", "有多少菜"],
      confidence: 0.88,
      reason: "用户已表达投稿但未指定匿名方式",
    })).toBe(true);
  });

  test("AI 已判断匿名时不需要待选择后提交标记", () => {
    expect(shouldSubmitPrivatePostAfterModeSelection({
      intent: "post",
      action: "none",
      text: "匿名吐槽一下食堂",
      anonymous: true,
      shouldSubmit: true,
      sections: ["匿名吐槽一下食堂"],
      confidence: 0.9,
      reason: "已指定匿名",
    })).toBe(false);
  });

  test("AI 未识别为投稿时仍进入继续添加流程", () => {
    expect(shouldSubmitPrivatePostAfterModeSelection({
      intent: "chat",
      action: "none",
      text: "食堂今天怎么样",
      anonymous: null,
      shouldSubmit: false,
      sections: ["食堂今天怎么样"],
      confidence: 0.7,
      reason: "尚未表达提交",
    })).toBe(false);
  });

  test("AI 收稿仅在配置启用且 LLM 可用时激活", () => {
    expect(isPrivatePostAiIntakeActive(true, true)).toBe(true);
    expect(isPrivatePostAiIntakeActive(true, false)).toBe(false);
    expect(isPrivatePostAiIntakeActive(false, true)).toBe(false);
  });

  test("pending 模式采纳 AI 语义识别到的匿名选择，不依赖关键词命令", () => {
    expect(resolvePrivatePostModeSelectionFromSemantic({
      intent: "chat",
      action: "none",
      text: "请问高考考的怎么样",
      anonymous: true,
      shouldSubmit: false,
      sections: ["请问高考考的怎么样"],
      confidence: 0.82,
      reason: "用户表达希望匿名发布",
    })).toEqual({ anonymous: true });

    expect(resolvePrivatePostModeSelectionFromSemantic({
      intent: "post",
      action: "none",
      text: "请问高考考的怎么样",
      anonymous: false,
      shouldSubmit: false,
      sections: ["请问高考考的怎么样"],
      confidence: 0.82,
      reason: "用户表达希望实名发布",
    })).toEqual({ anonymous: false });
  });

  test("私聊投稿创建成功后应通知审核群", () => {
    expect(shouldNotifyReviewGroupAfterPrivatePostCreate({ status: "pending_approval" })).toBe(true);
  });

  test("非待审核私聊投稿不触发新稿审核通知", () => {
    expect(shouldNotifyReviewGroupAfterPrivatePostCreate({ status: "approved" })).toBe(false);
  });
});
