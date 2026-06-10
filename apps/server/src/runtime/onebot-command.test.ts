import { describe, expect, test } from "bun:test";

import { parseCommand } from "./onebot";

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
