import { describe, expect, it } from "bun:test";
import { classifyHaltCandidate, renderManualPublishCaption } from "./manual-publish";
import { normalizeManualPublishTemplate, normalizeManualWallQq, manualPublishTemplateDefaults } from "../lib/tenant-metadata";
import { readTenantIngressAvailability } from "../lib/tenant-ingress";

describe("classifyHaltCandidate", () => {
  it("treats a post with any succeeded attempt as in-flight-or-done", () => {
    // A 目标已成功、B 目标仍在排队：稿件不能退回 approved——
    // pendingPublishWhere 会因存在 succeeded 尝试把它挡在待发布外，
    // 已发布列表又只查 published，稿件会从两个界面同时消失。
    expect(classifyHaltCandidate([
      { id: "a", status: "succeeded" },
      { id: "b", status: "queued" },
    ])).toBe("in-flight-or-done");
  });

  it("treats a running attempt as in-flight-or-done", () => {
    expect(classifyHaltCandidate([{ id: "a", status: "running" }])).toBe("in-flight-or-done");
  });

  it("marks cancellable attempts for halting", () => {
    expect(classifyHaltCandidate([
      { id: "a", status: "queued" },
      { id: "b", status: "failed" },
    ])).toBe("has-cancellable");
    expect(classifyHaltCandidate([{ id: "a", status: "waiting_cookies" }])).toBe("has-cancellable");
  });

  it("reports nothing to halt for skipped-only leftovers", () => {
    expect(classifyHaltCandidate([{ id: "a", status: "skipped" }])).toBe("nothing-to-halt");
    expect(classifyHaltCandidate([])).toBe("nothing-to-halt");
  });
});

describe("renderManualPublishCaption", () => {
  const baseTemplate = { customText: "", suffixText: "", includePostId: true, includeAuthorQq: false };

  it("defaults to just the post number", () => {
    expect(renderManualPublishCaption(baseTemplate, {
      displayId: 12, text: "正文", anonymous: false, authorQq: "123456",
    })).toBe("#12");
  });

  it("adds prefix, suffix and author mention when configured", () => {
    expect(renderManualPublishCaption(
      { customText: "#校园墙投稿", suffixText: "欢迎私信投稿", includePostId: true, includeAuthorQq: true },
      { displayId: 7, text: "正文", anonymous: false, authorQq: "123456" },
    )).toBe("#校园墙投稿 #7 @123456\n欢迎私信投稿");
  });

  it("never mentions the author for anonymous posts", () => {
    expect(renderManualPublishCaption(
      { customText: "", suffixText: "", includePostId: true, includeAuthorQq: true },
      { displayId: 7, text: "正文", anonymous: true, authorQq: "123456" },
    )).toBe("#7");
  });

  it("falls back to the post number when every part is disabled", () => {
    expect(renderManualPublishCaption(
      { customText: "", suffixText: "", includePostId: false, includeAuthorQq: false },
      { displayId: 9, text: "正文", anonymous: false, authorQq: "123456" },
    )).toBe("#9");
  });
});

describe("normalizeManualPublishTemplate", () => {
  it("returns defaults for malformed values", () => {
    expect(normalizeManualPublishTemplate(null)).toEqual(manualPublishTemplateDefaults);
    expect(normalizeManualPublishTemplate([])).toEqual(manualPublishTemplateDefaults);
    expect(normalizeManualPublishTemplate("x")).toEqual(manualPublishTemplateDefaults);
  });

  it("keeps booleans and trims over-long text", () => {
    const normalized = normalizeManualPublishTemplate({
      customText: "a".repeat(300),
      suffixText: "后缀",
      includePostId: false,
      includeAuthorQq: true,
    });
    expect(normalized.customText.length).toBe(200);
    expect(normalized.suffixText).toBe("后缀");
    expect(normalized.includePostId).toBe(false);
    expect(normalized.includeAuthorQq).toBe(true);
  });
});

describe("normalizeManualWallQq", () => {
  it("accepts digit-only QQ numbers of at least 5 digits", () => {
    expect(normalizeManualWallQq("123456789")).toBe("123456789");
    expect(normalizeManualWallQq(" 12345 ")).toBe("12345");
  });

  it("rejects short or non-numeric values", () => {
    expect(normalizeManualWallQq("1234")).toBe("");
    expect(normalizeManualWallQq("abc12345")).toBe("");
    expect(normalizeManualWallQq(null)).toBe("");
  });
});

describe("readTenantIngressAvailability", () => {
  it("is unavailable when guest submission is off", () => {
    expect(readTenantIngressAvailability({
      guestSubmission: { enabled: false },
      aggregateLogin: { enabled: false, autoCreateAccount: false },
    }).available).toBe(false);
  });

  it("treats guest submission as the only self-service registration channel", () => {
    expect(readTenantIngressAvailability({
      guestSubmission: { enabled: true },
      aggregateLogin: { enabled: false, autoCreateAccount: false },
    }).available).toBe(true);
  });

  it("does not count aggregate login as an ingress channel", () => {
    // 聚合登录的定位是给已存在的账号绑登录方式，不能用来注册新账号。
    expect(readTenantIngressAvailability({
      guestSubmission: { enabled: false },
      aggregateLogin: { enabled: true, autoCreateAccount: false },
    }).available).toBe(false);
    expect(readTenantIngressAvailability({
      guestSubmission: { enabled: false },
      aggregateLogin: { enabled: true, autoCreateAccount: true },
    }).available).toBe(false);
    // 但它的开启状态仍要如实反映出来，供界面提示。
    expect(readTenantIngressAvailability({
      guestSubmission: { enabled: false },
      aggregateLogin: { enabled: true, autoCreateAccount: true },
    }).aggregateLogin).toBe(true);
  });
});
