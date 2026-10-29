import { describe, expect, test } from "bun:test";

import { parsePrivatePostConfirmText } from "../lib/private-posting";
import {
  buildReviewHelp,
  isPrivatePostAiIntakeActive,
  shouldAppendPrivatePostContentForSemantic,
  shouldApplyPrivatePostSemanticText,
  shouldConfirmPrivatePostSubmissionFromSemantic,
  shouldNotifyReviewGroupAfterPrivatePostCreate,
  shouldRunPrivatePostKeywordCommand,
  shouldSubmitPrivatePostAfterModeSelection,
  parseBanCommandArgs,
  parseCommand,
  parseDisplayId,
  parseRejectArgs,
  parseReviewGroupCommand,
  parseReviewGroupShortCommand,
  parseUnbanCommandArgs,
  resolvePrivateForwardGroupId,
  resolvePrivatePostModeSelectionFromSemantic,
  resolvePrivatePostSemanticAction,
  resolveReviewPluginCommandBlock,
  shouldHandleReviewGroupCommandForBot,
  stripPrivateReplyHelpLines,
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

describe("parseDisplayId 混排与标点兼容", () => {
  test("纯数字", () => {
    expect(parseDisplayId("6724")).toBe(6724);
  });

  test("全角感叹号前缀（输入法粘连）", () => {
    expect(parseDisplayId("！6724")).toBe(6724);
  });

  test("全角感叹号后缀", () => {
    expect(parseDisplayId("6724！")).toBe(6724);
  });

  test("带 # 前缀", () => {
    expect(parseDisplayId("#6724")).toBe(6724);
  });

  test("无数字时返回 null", () => {
    expect(parseDisplayId("通过")).toBeNull();
  });

  test("夹杂普通文本时拒绝，避免误操作错误稿件", () => {
    expect(parseDisplayId("abc123")).toBeNull();
    expect(parseDisplayId("误操作 6724")).toBeNull();
    expect(parseDisplayId("123abc")).toBeNull();
  });
});

describe("parseRejectArgs 尾部标点兼容", () => {
  test("标准 理由 + 编号", () => {
    expect(parseRejectArgs("内容违规 6724")).toEqual({ comment: "内容违规", displayId: 6724 });
  });

  test("编号后带全角感叹号", () => {
    expect(parseRejectArgs("内容违规 6724！")).toEqual({ comment: "内容违规", displayId: 6724 });
  });

  test("编号带 # 前缀", () => {
    expect(parseRejectArgs("内容违规 #6724")).toEqual({ comment: "内容违规", displayId: 6724 });
  });

  test("理由中的句号等标点保留", () => {
    expect(parseRejectArgs("内容违规。请处理 6724")).toEqual({ comment: "内容违规。请处理", displayId: 6724 });
  });
});

describe("parseReviewGroupShortCommand", () => {
  test("去掉 CQ at 后识别「通过」", () => {
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 通过")).toEqual({ name: "通过", args: "" });
  });

  test("「过」简写", () => {
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 过")).toEqual({ name: "通过", args: "" });
  });

  test("通过带混排编号，args 原样交给 parseDisplayId", () => {
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 通过！6724")).toEqual({ name: "通过", args: "！6724" });
  });

  test("拒绝理由中的标点不得被改写", () => {
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 拒绝 内容违规。请处理 6724")).toEqual({
      name: "拒绝",
      args: "内容违规。请处理 6724",
    });
  });

  test("非审核简写返回 null", () => {
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 你好")).toBeNull();
  });

  test("与后续字词粘连时不当作命令（通过率/拒绝率/通过了）", () => {
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 通过率")).toBeNull();
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 拒绝率")).toBeNull();
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 通过了")).toBeNull();
    expect(parseReviewGroupShortCommand("[CQ:at,qq=10001] 过期")).toBeNull();
  });

  test("引用审核通知 + @bot + 过 仍应识别为通过（剥离 CQ:reply）", () => {
    expect(parseReviewGroupShortCommand("[CQ:reply,id=12345][CQ:at,qq=10001] 过")).toEqual({
      name: "通过",
      args: "",
    });
    expect(parseReviewGroupShortCommand("[CQ:reply,id=12345][CQ:at,qq=10001]通过")).toEqual({
      name: "通过",
      args: "",
    });
    expect(parseReviewGroupShortCommand("[CQ:reply,id=999][CQ:at,qq=10001] 拒绝 内容违规。请处理 6724")).toEqual({
      name: "拒绝",
      args: "内容违规。请处理 6724",
    });
  });
});

describe("parseCommand with reply noise", () => {
  test("引用后带 #通过 编号仍可解析", () => {
    expect(parseCommand("[CQ:reply,id=1]#通过 6724")).toEqual({ name: "通过", args: "6724" });
  });

  test("引用后 at + ＃通过 仍可解析", () => {
    expect(parseCommand("[CQ:reply,id=1][CQ:at,qq=10001] ＃通过 6724")).toEqual({ name: "通过", args: "6724" });
  });

  test("引用夹在命令与稿件编号之间时仍分开解析（空格替换）", () => {
    // 若把 CQ 段直接删成空串，会变成 #通过6724，命令名/参数粘连
    expect(parseCommand("#通过[CQ:reply,id=999]6724")).toEqual({ name: "通过", args: "6724" });
    expect(parseReviewGroupShortCommand("[CQ:at,qq=1]通过[CQ:reply,id=2] 6724")).toEqual({
      name: "通过",
      args: "6724",
    });
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

describe("review group multi-bot routing", () => {
  test("未 @ 的审核群命令只由首选审核通知 Bot 处理", () => {
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-a",
      currentBotQqUin: "10000",
      mentionedBotQqUins: [],
      preferredBotId: "bot-a",
    })).toBe(true);
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-b",
      currentBotQqUin: "20000",
      mentionedBotQqUins: [],
      preferredBotId: "bot-a",
    })).toBe(false);
  });

  test("@ 指定 Bot 时由被 @ 的 Bot 处理", () => {
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-b",
      currentBotQqUin: "20000",
      mentionedBotQqUins: ["20000"],
      preferredBotId: "bot-a",
    })).toBe(true);
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-a",
      currentBotQqUin: "10000",
      mentionedBotQqUins: ["20000"],
      preferredBotId: "bot-a",
    })).toBe(false);
  });

  test("没有首选审核通知 Bot 时保持兼容由当前审核群 Bot 处理", () => {
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-b",
      currentBotQqUin: "20000",
      mentionedBotQqUins: [],
      preferredBotId: null,
    })).toBe(true);
  });

  test("被 @ 的墙号处理命令（即使引用的是其他墙号的消息）", () => {
    // 审核员引用 2 墙号的通知但手动 @ 了 1 墙号：由被 @ 的墙号处理
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-a",
      currentBotQqUin: "10000",
      mentionedBotQqUins: ["10000"],
      preferredBotId: "bot-b",
      quotedBotSenderQqUin: "20000",
    })).toBe(true);
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-b",
      currentBotQqUin: "20000",
      mentionedBotQqUins: ["10000"],
      preferredBotId: "bot-b",
      quotedBotSenderQqUin: "20000",
    })).toBe(false);
  });

  test("QQ 回复自动 @ 被引用墙号叠加手动 @ 时，只由被引用墙号处理", () => {
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-b",
      currentBotQqUin: "20000",
      mentionedBotQqUins: ["10000", "20000"],
      preferredBotId: "bot-b",
      quotedBotSenderQqUin: "20000",
    })).toBe(true);
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-a",
      currentBotQqUin: "10000",
      mentionedBotQqUins: ["10000", "20000"],
      preferredBotId: "bot-b",
      quotedBotSenderQqUin: "20000",
    })).toBe(false);
  });

  test("未 @ 时由首选通知墙号处理，引用不改变归属", () => {
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-b",
      currentBotQqUin: "20000",
      mentionedBotQqUins: [],
      preferredBotId: "bot-b",
      quotedBotSenderQqUin: "10000",
    })).toBe(true);
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-a",
      currentBotQqUin: "10000",
      mentionedBotQqUins: [],
      preferredBotId: "bot-b",
      quotedBotSenderQqUin: "10000",
    })).toBe(false);
  });

  test("引用普通用户消息时不影响原有路由", () => {
    expect(shouldHandleReviewGroupCommandForBot({
      currentBotId: "bot-a",
      currentBotQqUin: "10000",
      mentionedBotQqUins: ["10000"],
      preferredBotId: "bot-b",
      quotedBotSenderQqUin: null,
    })).toBe(true);
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

  test("AI 确认提交阶段兼容只有 shouldSubmit 的语义结果", () => {
    expect(shouldConfirmPrivatePostSubmissionFromSemantic({
      intent: "post",
      action: "none",
      text: "正文",
      anonymous: null,
      shouldSubmit: true,
      sections: ["正文"],
      confidence: 0.82,
      reason: "用户确认可以发布当前稿件",
    })).toEqual({ confirmed: true });
  });

  test("AI 确认提交阶段从语义文本识别取消意图", () => {
    for (const text of ["取消", "取消投稿", "确认取消投稿"]) {
      expect(shouldConfirmPrivatePostSubmissionFromSemantic({
        intent: "post",
        action: "none",
        text,
        anonymous: null,
        shouldSubmit: false,
        sections: [text],
        confidence: 0.82,
        reason: "用户表达取消当前投稿",
      })).toEqual({ confirmed: false });
    }
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
    for (const text of ["取消投稿", "撤销稿件", "不要投了", "不发了"]) {
      expect(resolvePrivatePostSemanticAction({
        intent: "post",
        action: "none",
        text,
        anonymous: null,
        shouldSubmit: false,
        sections: [text],
        confidence: 0.82,
        reason: "用户表达取消当前投稿编辑",
      })).toBe("cancel");
    }
    for (const text of ["撤回投稿", "撤销投稿", "撤销稿件"]) {
      expect(resolvePrivatePostSemanticAction({
        intent: "command",
        action: "undo",
        text,
        anonymous: null,
        shouldSubmit: false,
        sections: [],
        confidence: 0.82,
        reason: "用户想撤回本次投稿",
      })).toBe("cancel");
    }
    expect(resolvePrivatePostSemanticAction({
      intent: "command",
      action: "none",
      text: "",
      anonymous: null,
      shouldSubmit: false,
      sections: [],
      confidence: 0.82,
      reason: "用户明确表示取消投稿",
    })).toBe("cancel");
    expect(resolvePrivatePostSemanticAction({
      intent: "post",
      action: "none",
      text: "再补充一句正文",
      anonymous: null,
      shouldSubmit: false,
      sections: ["再补充一句正文"],
      confidence: 0.82,
      reason: "用户是在补充正文，不是取消投稿",
    })).toBeNull();
    expect(resolvePrivatePostSemanticAction({
      intent: "post",
      action: "none",
      text: "学校取消活动后补偿方案太不合理了",
      anonymous: null,
      shouldSubmit: false,
      sections: ["学校取消活动后补偿方案太不合理了"],
      confidence: 0.82,
      reason: "用户没有表示要取消，只是补充正文",
    })).toBeNull();
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

describe("审核群帮助文本按插件开关裁剪", () => {
  test("插件全关时不出现毕业与投票指令", () => {
    const help = buildReviewHelp({ graduation: false, campaigns: false });
    expect(help).toContain("#通过 <稿件id>");
    expect(help).toContain("#登录 或 #刷新qzone cookies");
    expect(help).not.toContain("#毕业通过");
    expect(help).not.toContain("#投票通过");
  });

  test("启用毕业去向只补毕业指令", () => {
    const help = buildReviewHelp({ graduation: true, campaigns: false });
    expect(help).toContain("#毕业通过 <毕业去向编号>");
    expect(help).toContain("#毕业拒绝 <理由> <毕业去向编号>");
    expect(help).not.toContain("#投票通过");
  });

  test("默认在审核群展示 #回复", () => {
    expect(buildReviewHelp({ graduation: false, campaigns: false })).toContain("#回复 <内容>");
  });

  test("私聊转发到其他群时审核群帮助不再出现 #回复", () => {
    const help = buildReviewHelp({ graduation: false, campaigns: false }, { includePrivateReply: false });
    expect(help).not.toContain("#回复");
    expect(help).toContain("#通过 <稿件id>");
  });

  test("启用投票竞选补投票指令", () => {
    const help = buildReviewHelp({ graduation: false, campaigns: true });
    expect(help).toContain("#投票通过 <竞选编号>");
    expect(help).toContain("#投票拒绝 <理由> <竞选编号>");
    expect(help).not.toContain("#毕业通过");
  });
});

describe("插件未启用时拦截审核群指令", () => {
  test("核心稿件指令不受插件开关影响", () => {
    expect(resolveReviewPluginCommandBlock("通过", { graduation: false, campaigns: false })).toBeNull();
    expect(resolveReviewPluginCommandBlock("审核队列", { graduation: false, campaigns: false })).toBeNull();
  });

  test("毕业去向未开启时拦截毕业指令并提示", () => {
    const message = resolveReviewPluginCommandBlock("毕业通过", { graduation: false, campaigns: true });
    expect(message).toContain("毕业去向");
    expect(message).toContain("未开启");
  });

  test("投票竞选未开启时拦截投票指令", () => {
    expect(resolveReviewPluginCommandBlock("投票拒绝", { graduation: true, campaigns: false })).toContain("投票竞选");
  });

  test("插件开启后放行对应指令", () => {
    expect(resolveReviewPluginCommandBlock("毕业拒绝", { graduation: true, campaigns: false })).toBeNull();
    expect(resolveReviewPluginCommandBlock("投票通过", { graduation: false, campaigns: true })).toBeNull();
  });

  test("开启状态与拦截状态成对出现，避免漏登记时测试仍通过", () => {
    const gated = [
      ["毕业通过", "graduation"],
      ["毕业拒绝", "graduation"],
      ["投票通过", "campaigns"],
      ["投票拒绝", "campaigns"],
    ] as const;
    for (const [command, plugin] of gated) {
      const flags = { graduation: plugin === "graduation", campaigns: plugin === "campaigns" };
      expect(resolveReviewPluginCommandBlock(command, flags)).toBeNull();
      expect(resolveReviewPluginCommandBlock(command, { ...flags, [plugin]: false })).not.toBeNull();
    }
  });

  test("未知指令（含对象原型属性）不被误拦截", () => {
    for (const command of ["构造", "constructor", "toString", "__proto__"]) {
      expect(resolveReviewPluginCommandBlock(command, { graduation: false, campaigns: false })).toBeNull();
    }
  });

  test("配置读取失败时提示可区分，且核心指令不受影响", () => {
    expect(resolveReviewPluginCommandBlock("通过", null)).toBeNull();
    const blocked = resolveReviewPluginCommandBlock("毕业通过", null);
    expect(blocked).toContain("暂时无法读取");
    expect(blocked).not.toContain("未开启");
  });
});

describe("私聊消息转发群号解析", () => {
  test("未设置或空串表示不转发", () => {
    expect(resolvePrivateForwardGroupId({ privateForwardGroupId: null })).toBeNull();
    expect(resolvePrivateForwardGroupId({ privateForwardGroupId: "" })).toBeNull();
    expect(resolvePrivateForwardGroupId({ privateForwardGroupId: "   " })).toBeNull();
    expect(resolvePrivateForwardGroupId({})).toBeNull();
  });

  test("配置了群号则转发到该群，与审核群无关", () => {
    expect(resolvePrivateForwardGroupId({ privateForwardGroupId: "123456" })).toBe("123456");
    expect(resolvePrivateForwardGroupId({ privateForwardGroupId: " 789012 " })).toBe("789012");
  });
});

describe("自定义审核群提示过滤 #回复", () => {
  test("转发到其他群时去掉 #回复 行", () => {
    const text = "审核命令：\n#通过 <稿件id>\n#回复 <内容>（引用转发）\n#扫码登录";
    expect(stripPrivateReplyHelpLines(text)).toBe("审核命令：\n#通过 <稿件id>\n#扫码登录");
  });

  test("没有 #回复 行时原样返回（去掉首尾空白）", () => {
    expect(stripPrivateReplyHelpLines("  审核命令：\n#通过 <稿件id>  ")).toBe("审核命令：\n#通过 <稿件id>");
  });
});
