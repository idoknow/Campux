import { describe, expect, test } from "bun:test";

import { parseBanCommandArgs, parseCommand, parseReviewGroupCommand, parseUnbanCommandArgs, resolvePrivatePostModeSelectionFromSemantic, shouldSubmitPrivatePostAfterModeSelection } from "./onebot";

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
  test("AI 已识别投稿但匿名未知时，选完匿名后应直接提交", () => {
    expect(shouldSubmitPrivatePostAfterModeSelection({
      intent: "post",
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
      text: "食堂今天怎么样",
      anonymous: null,
      shouldSubmit: false,
      sections: ["食堂今天怎么样"],
      confidence: 0.7,
      reason: "尚未表达提交",
    })).toBe(false);
  });

  test("pending 模式采纳 AI 语义识别到的匿名选择，不依赖关键词命令", () => {
    expect(resolvePrivatePostModeSelectionFromSemantic({
      intent: "chat",
      text: "请问高考考的怎么样",
      anonymous: true,
      shouldSubmit: false,
      sections: ["请问高考考的怎么样"],
      confidence: 0.82,
      reason: "用户表达希望匿名发布",
    })).toEqual({ anonymous: true });

    expect(resolvePrivatePostModeSelectionFromSemantic({
      intent: "post",
      text: "请问高考考的怎么样",
      anonymous: false,
      shouldSubmit: false,
      sections: ["请问高考考的怎么样"],
      confidence: 0.82,
      reason: "用户表达希望实名发布",
    })).toEqual({ anonymous: false });
  });
});
