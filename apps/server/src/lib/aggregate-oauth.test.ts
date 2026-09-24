import { describe, expect, test } from "bun:test";
import {
  extractAggregateLoginUrlState,
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

describe("extractAggregateLoginUrlState", () => {
  test("提取聚合站自带 state（login.mapay.cn 形态）", () => {
    const loginUrl =
      "https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=1904052269&redirect_uri=https%3A%2F%2Flogin.mapay.cn%2Freturn.php&state=5542UtcdYNo5";
    expect(extractAggregateLoginUrlState(loginUrl)).toBe("5542UtcdYNo5");
  });

  test("无 state 时返回 undefined", () => {
    expect(extractAggregateLoginUrlState("https://graph.qq.com/oauth2.0/authorize?client_id=x")).toBeUndefined();
  });

  test("非法 URL 返回 undefined 而不是抛错", () => {
    expect(extractAggregateLoginUrlState("not a url")).toBeUndefined();
  });
});

describe("normalizeReturnPath 语义（防开放重定向）", () => {
  // 该函数在 routes/aggregate-oauth.ts 内，这里用等价规则验证 WHATWG 行为。
  const normalize = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    if (!value.startsWith("/") || value.startsWith("//")) return undefined;
    if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
    try {
      const url = new URL(value, "https://campux.invalid");
      if (url.origin !== "https://campux.invalid") return undefined;
    } catch {
      return undefined;
    }
    return value;
  };

  test("反斜杠绕过（\\evil.com 会被 WHATWG 解析为跨域）被拒绝", () => {
    expect(normalize("/\\evil.com")).toBeUndefined();
  });

  test("协议相对地址 //evil.com 被拒绝", () => {
    expect(normalize("//evil.com")).toBeUndefined();
  });

  test("正常站内路径保留", () => {
    expect(normalize("/services?a=1")).toBe("/services?a=1");
  });
});