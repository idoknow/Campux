import { describe, expect, it } from "bun:test";
import { withTenantReviewSlot, parsePersistedPostReviewDetail, parsePostReviewAssessment, readBoundedLlmResponse } from "./post-review";
import { assertSafeLlmUrl } from "./llm-url";

describe("withTenantReviewSlot", () => {
  it("limits concurrent work independently for each tenant", async () => {
    const started: Array<() => void> = [];
    const deferred = () => new Promise<void>((resolve) => started.push(resolve));
    const first = withTenantReviewSlot("tenant-a", deferred);
    const second = withTenantReviewSlot("tenant-a", deferred);
    await Promise.resolve();
    const rejected = await withTenantReviewSlot("tenant-a", async () => "unexpected");
    const otherTenant = withTenantReviewSlot("tenant-b", async () => "allowed");
    expect(rejected).toBeNull();
    await expect(otherTenant).resolves.toBe("allowed");
    started.splice(0).forEach((release) => release());
    await Promise.all([first, second]);
  });
});
describe("parsePostReviewAssessment", () => {
  it("accepts only a bounded advisory assessment", () => {
    expect(parsePostReviewAssessment('{"riskLevel":"high","category":"harassment","reason":"Contains a direct insult","confidence":0.92}')).toEqual({
      riskLevel: "high", category: "harassment", reason: "Contains a direct insult", confidence: 0.92,
    });
  });
  it("rejects malformed, unsupported, and out-of-range model output", () => {
    expect(parsePostReviewAssessment("not json")).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"reject","category":"x","reason":"x","confidence":0.5}')).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"low","category":"x","reason":"x","confidence":3}')).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"low","category":"x","reason":"x","confidence":0.5,"decision":"approve"}')).toBeNull();
  });

  it("validates persisted audit detail before returning it", () => {
    expect(parsePersistedPostReviewDetail({ mode: "assist", status: "failed" })).toEqual({ status: "failed" });
    expect(parsePersistedPostReviewDetail({ mode: "shadow", status: "completed" })).toBeNull();
    expect(parsePersistedPostReviewDetail({ mode: "assist", status: "completed", assessment: { riskLevel: "low" } })).toBeNull();
  });
});

describe("readBoundedLlmResponse", () => {
  it("reads a response within the configured byte limit", async () => {
    const response = new Response("{\"ok\":true}");
    await expect(readBoundedLlmResponse(response, 32)).resolves.toBe("{\"ok\":true}");
  });
  it("rejects declared and streamed responses over the limit", async () => {
    await expect(readBoundedLlmResponse(new Response("12345", { headers: { "content-length": "5" } }), 4)).rejects.toThrow();
    await expect(readBoundedLlmResponse(new Response("12345"), 4)).rejects.toThrow();
    const noContentLength = new Response("12345");
    Object.defineProperty(noContentLength.headers, "get", { value: () => null });
    await expect(readBoundedLlmResponse(noContentLength, 4)).rejects.toThrow();
  });
});


describe("assertSafeLlmUrl", () => {
  it("allows public HTTPS service URLs", async () => {
    await expect(assertSafeLlmUrl("https://example.com/v1")).resolves.toBeInstanceOf(URL);
  });
  it("rejects non-HTTPS, local, and private-network endpoints", async () => {
    for (const url of ["http://api.example.com/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.0.0.8/v1", "https://192.168.1.8/v1", "https://[::1]/v1", "file:///etc/passwd"]) {
      await expect(assertSafeLlmUrl(url)).rejects.toThrow();
    }
  });
});
