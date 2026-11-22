import { describe, expect, it } from "bun:test";
import { resolvePasswordResetChannel } from "./tenant-metadata";
import {
  checkQqEmailMatchesQqUin,
  emailDomain,
  isEmailAllowedByPolicy,
  normalizeAllowedSuffixes,
  normalizeEmailSuffix,
  normalizeRegistrationEmailPolicy,
  qqUinFromQqEmail,
} from "./registration-email-policy";

describe("normalizeEmailSuffix", () => {
  it("strips @/dots and lowercases", () => {
    expect(normalizeEmailSuffix("@QQ.com")).toBe("qq.com");
    expect(normalizeEmailSuffix(".163.com")).toBe("163.com");
    expect(normalizeEmailSuffix("  Edu.CN ")).toBe("edu.cn");
  });

  it("rejects single-label or malformed suffixes", () => {
    // 只写 "com" 会放开所有 .com 域，必须拒绝。
    expect(normalizeEmailSuffix("com")).toBeNull();
    expect(normalizeEmailSuffix("")).toBeNull();
    expect(normalizeEmailSuffix("a b.com")).toBeNull();
    expect(normalizeEmailSuffix(null)).toBeNull();
  });
});

describe("normalizeAllowedSuffixes", () => {
  it("dedupes and preserves order, capped", () => {
    expect(normalizeAllowedSuffixes(["qq.com", "QQ.com", "@163.com"])).toEqual(["qq.com", "163.com"]);
  });

  it("returns empty array for non-arrays", () => {
    expect(normalizeAllowedSuffixes(null)).toEqual([]);
    expect(normalizeAllowedSuffixes("qq.com")).toEqual([]);
  });
});

describe("normalizeRegistrationEmailPolicy", () => {
  it("defaults to not required with no restriction", () => {
    expect(normalizeRegistrationEmailPolicy(null)).toEqual({ required: false, allowedSuffixes: [] });
    expect(normalizeRegistrationEmailPolicy("x")).toEqual({ required: false, allowedSuffixes: [] });
  });

  it("keeps required and suffixes", () => {
    expect(normalizeRegistrationEmailPolicy({ required: true, allowedSuffixes: ["qq.com"] }))
      .toEqual({ required: true, allowedSuffixes: ["qq.com"] });
  });
});

describe("isEmailAllowedByPolicy", () => {
  it("allows any valid email when suffix list is empty (不限制)", () => {
    expect(isEmailAllowedByPolicy("a@whatever.dev", { required: true, allowedSuffixes: [] }).ok).toBe(true);
  });

  it("rejects domains outside the allow list", () => {
    const policy = { required: true, allowedSuffixes: ["qq.com"] };
    expect(isEmailAllowedByPolicy("12345@qq.com", policy).ok).toBe(true);
    expect(isEmailAllowedByPolicy("a@163.com", policy).ok).toBe(false);
    expect(isEmailAllowedByPolicy("a@gmail.com", policy).ok).toBe(false);
  });

  it("matches subdomains of an allowed suffix", () => {
    const policy = { required: true, allowedSuffixes: ["edu.cn"] };
    expect(isEmailAllowedByPolicy("student@mail.tsinghua.edu.cn", policy).ok).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(isEmailAllowedByPolicy("not-an-email", { required: true, allowedSuffixes: [] }).ok).toBe(false);
  });
});

describe("emailDomain", () => {
  it("extracts lowercase domain", () => {
    expect(emailDomain("User@QQ.COM")).toBe("qq.com");
    expect(emailDomain("bad")).toBeNull();
  });
});

describe("qqUinFromQqEmail", () => {
  it("recognises <qq>@qq.com only", () => {
    expect(qqUinFromQqEmail("123456@qq.com")).toBe("123456");
    // foxmail 虽然也属腾讯，但前缀不保证是 QQ 号。
    expect(qqUinFromQqEmail("123456@foxmail.com")).toBeNull();
    expect(qqUinFromQqEmail("123456@163.com")).toBeNull();
  });
});

describe("resolvePasswordResetChannel", () => {
  it("uses bot private message in bot mode", () => {
    expect(resolvePasswordResetChannel("bot")).toBe("bot-private-message");
  });

  it("uses web email in manual mode", () => {
    expect(resolvePasswordResetChannel("manual")).toBe("web-email");
  });
});

describe("checkQqEmailMatchesQqUin", () => {
  it("requires the QQ number to match the qq.com prefix", () => {
    expect(checkQqEmailMatchesQqUin("123456@qq.com", "123456").ok).toBe(true);
    const mismatch = checkQqEmailMatchesQqUin("123456@qq.com", "999999");
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toContain("123456");
  });

  it("skips the check for non-qq.com mailboxes", () => {
    expect(checkQqEmailMatchesQqUin("someone@163.com", "999999").ok).toBe(true);
    expect(checkQqEmailMatchesQqUin("someone@foxmail.com", "999999").ok).toBe(true);
  });
});
