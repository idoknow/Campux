import { describe, expect, test } from "bun:test";
import {
  getAggregateOauthLoginTypesOrDefault,
  normalizeAggregateEndpoint,
  normalizeAggregateOauthLoginTypes,
} from "./aggregate-oauth";

describe("normalizeAggregateOauthLoginTypes", () => {
  test("接受数组并去重、去未知、转小写、保序", () => {
    expect(normalizeAggregateOauthLoginTypes(["QQ", "wx", "qq", "unknown", "Baidu", "WX"])).toEqual([
      "qq",
      "wx",
      "baidu",
    ]);
  });

  test("接受 JSON 字符串数组", () => {
    expect(normalizeAggregateOauthLoginTypes('["qq","bilibili"]')).toEqual(["qq", "bilibili"]);
  });

  test("接受逗号分隔字符串", () => {
    expect(normalizeAggregateOauthLoginTypes("alipay,douyin,nope")).toEqual(["alipay", "douyin"]);
  });

  test("空输入返回空数组", () => {
    expect(normalizeAggregateOauthLoginTypes([])).toEqual([]);
    expect(normalizeAggregateOauthLoginTypes("")).toEqual([]);
    expect(normalizeAggregateOauthLoginTypes(undefined)).toEqual([]);
    expect(normalizeAggregateOauthLoginTypes("  ,  ")).toEqual([]);
  });

  test("完全未知值返回空数组", () => {
    expect(normalizeAggregateOauthLoginTypes(["not-a-provider"])).toEqual([]);
  });
});

describe("getAggregateOauthLoginTypesOrDefault", () => {
  test("未配置任何值 → 返回空数组（不默认放任何平台，等待管理员勾选）", () => {
    expect(getAggregateOauthLoginTypesOrDefault([])).toEqual([]);
    expect(getAggregateOauthLoginTypesOrDefault("")).toEqual([]);
    expect(getAggregateOauthLoginTypesOrDefault(undefined)).toEqual([]);
  });

  test("显式配置了值 → 返回归一化后的该值", () => {
    expect(getAggregateOauthLoginTypesOrDefault(["douyin"])).toEqual(["douyin"]);
    expect(getAggregateOauthLoginTypesOrDefault("wx,alipay")).toEqual(["wx", "alipay"]);
  });
});

describe("normalizeAggregateEndpoint", () => {
  test("接受合法 https 端点并去尾斜杠/query/hash", () => {
    expect(normalizeAggregateEndpoint("https://a.idcfx.net/connect.php")).toBe(
      "https://a.idcfx.net/connect.php",
    );
    expect(normalizeAggregateEndpoint("https://a.idcfx.net/connect.php/")).toBe(
      "https://a.idcfx.net/connect.php",
    );
    expect(normalizeAggregateEndpoint("https://a.idcfx.net/connect.php?a=1#h")).toBe(
      "https://a.idcfx.net/connect.php",
    );
  });

  test("拒绝 http / 非法 / 空端点", () => {
    expect(() => normalizeAggregateEndpoint("http://a.idcfx.net/connect.php")).toThrow(
      /必须为 https/,
    );
    expect(() => normalizeAggregateEndpoint("not a url")).toThrow();
    expect(() => normalizeAggregateEndpoint("")).toThrow();
    expect(() => normalizeAggregateEndpoint("   ")).toThrow();
  });
});