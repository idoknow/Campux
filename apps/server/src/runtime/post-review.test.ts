import { describe, expect, it } from "bun:test";
import { withTenantReviewSlot, parsePersistedPostReviewDetail, parsePostReviewAnalysisRecord, parsePostReviewAssessment, validatePostReviewEvidence, readBoundedLlmResponse, llmOutputTokenBudget, llmFinishReason, postReviewSystemPrompt } from "./post-review";
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
describe("global post review prompt", () => {
  it("covers euphemism and context-sensitive risks while avoiding guesses", () => {
    expect(postReviewSystemPrompt).toContain("委婉表达");
    expect(postReviewSystemPrompt).toContain("上下文指代");
    expect(postReviewSystemPrompt).toContain("不要猜测");
    expect(postReviewSystemPrompt).toContain("倾向 manual_review");
  });
});

describe("parsePostReviewAssessment", () => {
  it("exposes persisted shadow results as comparison-only analysis", () => {
    const shadowRecord = { id: "analysis-1", mode: "shadow", status: "completed", riskLevel: "high", confidence: 0.9, categories: ["privacy"], sensitiveFindings: [], suggestedAction: "manual_review", reasons: ["reason"], maskedText: null, rewrittenText: null, rejectionReason: null };
    expect(parsePostReviewAnalysisRecord(shadowRecord)).toEqual(expect.objectContaining({ mode: "shadow", status: "completed" }));
    expect(parsePostReviewAnalysisRecord({ ...shadowRecord, mode: "assist" })).toEqual(expect.objectContaining({ mode: "assist", status: "completed" }));
  });
  it("accepts legacy v1 shape and normalizes schemaVersion", () => {
    const parsed = parsePostReviewAssessment('{"riskLevel":"low","categories":[],"sensitiveFindings":[],"suggestedAction":"manual_review","reasons":["review"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}');
    expect(parsed?.schemaVersion).toBe(1);
    expect(parsePostReviewAssessment('{"schemaVersion":2,"riskLevel":"low","categories":[],"sensitiveFindings":[],"suggestedAction":"manual_review","reasons":["review"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toBeNull();
  });

  it("maps the legacy revise recommendation to human review", () => {
    const parsed = parsePostReviewAssessment('{"riskLevel":"medium","categories":[],"sensitiveFindings":[],"suggestedAction":"revise","reasons":["needs context"],"confidence":0.7,"maskedText":null,"rewrittenText":null,"rejectionReason":null}');
    expect(parsed?.suggestedAction).toBe("manual_review");
  });

  it("requires exact source grounding for findings, including Unicode", () => {
    const parsed = parsePostReviewAssessment('{"riskLevel":"low","categories":[],"sensitiveFindings":[{"type":"privacy","excerpt":"李雷🌱","reason":"reason"}],"suggestedAction":"manual_review","reasons":["free-form reason"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')!;
    expect(validatePostReviewEvidence("原文：李雷🌱。", parsed)).not.toBeNull();
    const invalidAssessment = {
      ...parsed!,
      sensitiveFindings: [{ type: "privacy", excerpt: "LiLei", reason: "name" }],
    };
    expect(validatePostReviewEvidence("LiLeis is not an exact token", invalidAssessment)).toBeNull();
    expect(validatePostReviewEvidence("Mention LiLei here", invalidAssessment)).not.toBeNull();
  });

  it("accepts only a bounded advisory assessment", () => {
    expect(parsePostReviewAssessment('{"riskLevel":"high","categories":["骚扰攻击"],"sensitiveFindings":[],"suggestedAction":"manual_review","reasons":["包含针对性攻击"],"confidence":0.92,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toEqual({
      schemaVersion: 1, riskLevel: "high", categories: ["骚扰攻击"], sensitiveFindings: [], suggestedAction: "manual_review", reasons: ["包含针对性攻击"], confidence: 0.92, maskedText: null, rewrittenText: null, rejectionReason: null,
    });
  });
  it("rejects malformed, unsupported, and out-of-range model output", () => {
    expect(parsePostReviewAssessment("not json")).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"reject","categories":["x"],"sensitiveFindings":[],"suggestedAction":"approve","reasons":["x"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"low","categories":["x"],"sensitiveFindings":[],"suggestedAction":"approve","reasons":["x"],"confidence":3,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"low","categories":["x"],"sensitiveFindings":[],"suggestedAction":"approve","reasons":["x"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null,"decision":"approve"}')).toBeNull();
  });

  it("validates persisted audit detail before returning it", () => {
    expect(parsePersistedPostReviewDetail({ mode: "assist", status: "failed" })).toEqual({ mode: "assist", status: "failed" });
    expect(parsePersistedPostReviewDetail({ mode: "shadow", status: "completed", assessment: { riskLevel: "low", categories: [], sensitiveFindings: [], suggestedAction: "manual_review", reasons: ["review"], confidence: 0.8, maskedText: null, rewrittenText: null, rejectionReason: null } })).toEqual(expect.objectContaining({ mode: "shadow", status: "completed" }));
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

describe("llm output token budget", () => {
  it("keeps short inputs at the floor instead of a tiny fixed cap", () => {
    expect(llmOutputTokenBudget(0, { floor: 600 })).toBe(600);
    expect(llmOutputTokenBudget(30, { floor: 600, multiplier: 1.8, padding: 300 })).toBe(600);
  });

  it("scales with input length so long posts are not truncated", () => {
    const short = llmOutputTokenBudget(400, { floor: 1000, multiplier: 2.4, padding: 600 });
    const long = llmOutputTokenBudget(2000, { floor: 1000, multiplier: 2.4, padding: 600 });
    expect(short).toBe(1560);
    expect(long).toBe(4096);
    expect(long).toBeGreaterThan(short);
  });

  it("reads finish_reason and treats missing envelope as unknown", () => {
    expect(llmFinishReason({ choices: [{ finish_reason: "length" }] })).toBe("length");
    expect(llmFinishReason({ choices: [{ finish_reason: "stop" }] })).toBe("stop");
    expect(llmFinishReason(null)).toBeNull();
    expect(llmFinishReason({})).toBeNull();
  });
});
