import { describe, expect, test } from "bun:test";
import { buildSchoolRelationContext, parseSchoolRelationExtraction, validateSchoolRelationEvidence, schoolRelationSourceExcerpt } from "./post-review";
import type { FastifyBaseLogger } from "fastify";
import { withTenantReviewSlot, clampAiReviewConcurrency, parsePersistedPostReviewDetail, parsePostReviewAnalysisRecord, parsePostReviewAssessment, validatePostReviewEvidence, readBoundedLlmResponse, llmOutputTokenBudget, llmFinishReason, postReviewSystemPrompt, writeAutoAssessmentDecision, retryLlmReviewRequest } from "./post-review";
import { assertSafeLlmUrl } from "./llm-url";

describe("school relation extraction", () => {
  test("requires one verbatim evidence span containing both entities and predicate support", () => {
    const relation = { subject: "图书馆", predicate: "located_at" as const, object: "东区", evidence: "图书馆位于东区" };
    expect(validateSchoolRelationEvidence(relation, "图书馆位于东区。" )).toBe(true);
    expect(validateSchoolRelationEvidence(relation, "图书馆和东区都在这篇稿件里，但未说明关系。" )).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆 东区 位于" }, "图书馆 东区 位于" )).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: `图书馆${"旁边".repeat(20)}位于东区` }, `图书馆${"旁边".repeat(20)}位于东区` )).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆 东区" }, "图书馆 东区" )).toBe(false);
  });
  test("returns a bounded source excerpt containing the evidence", () => {
    const text = `${"前文".repeat(100)}图书馆位于东区${"后文".repeat(100)}`;
    const excerpt = schoolRelationSourceExcerpt(text, "图书馆位于东区", 80);
    expect(excerpt.length).toBeLessThanOrEqual(80);
    expect(excerpt).toContain("图书馆位于东区");
  });
  test("accepts allowlisted factual relation schema and rejects PII or invalid predicates", () => {
    expect(parseSchoolRelationExtraction(JSON.stringify({ relations: [{ subject: "图书馆", predicate: "located_at", object: "东区", evidence: "图书馆在东区" }] }))).toHaveLength(1);
    expect(parseSchoolRelationExtraction(JSON.stringify({ relations: [{ subject: "图书馆", predicate: "invented", object: "东区", evidence: "在东区" }] }))).toBeNull();
    expect(parseSchoolRelationExtraction(JSON.stringify({ relations: [{ subject: "图书馆", predicate: "located_at", object: "东区", evidence: "13812345678" }] }))).toBeNull();
  });
  test("requires one quoted source span containing both entities and a predicate cue", () => {
    const relation = { subject: "图书馆", predicate: "located_at" as const, object: "东区", evidence: "图书馆位于东区" };
    expect(validateSchoolRelationEvidence(relation, "图书馆位于东区。欢迎来访。")).toBe(true);
    expect(validateSchoolRelationEvidence(relation, "图书馆很漂亮，东区有很多楼。无关系。" )).toBe(false);
  });
  test("grounds the claimed predicate between the ordered entities and rejects negation, reverse direction, and incidental cues", () => {
    const relation = { subject: "图书馆", predicate: "located_at" as const, object: "东区", evidence: "图书馆位于东区" };
    expect(validateSchoolRelationEvidence(relation, "图书馆位于东区")).toBe(true);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆不位于东区" }, "图书馆不位于东区")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆不是位于东区" }, "图书馆不是位于东区")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆在东区，东区位于图书馆" }, "图书馆在东区，东区位于图书馆")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆很漂亮，在东区" }, "图书馆很漂亮，在东区")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆附近有东区" }, "图书馆附近有东区")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "图书馆 is not in 东区" }, "图书馆 is not in 东区")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, evidence: "东区位于图书馆" }, "东区位于图书馆")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, predicate: "member_of", evidence: "图书馆在东区，东区" }, "图书馆在东区，东区")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, predicate: "offers", evidence: "图书馆欢迎参观，东区提供课程" }, "图书馆欢迎参观，东区提供课程")).toBe(false);
    expect(validateSchoolRelationEvidence({ ...relation, predicate: "member_of", evidence: "图书馆隶属于东区" }, "图书馆隶属于东区")).toBe(true);
    expect(validateSchoolRelationEvidence({ ...relation, predicate: "offers", evidence: "图书馆提供东区课程" }, "图书馆提供东区课程")).toBe(true);
  });
  test("returns only bounded excerpt around the verbatim evidence", () => {
    const excerpt = schoolRelationSourceExcerpt("前言。" + "甲".repeat(3000) + "图书馆位于东区" + "乙".repeat(3000), "图书馆位于东区", 200);
    expect(excerpt).toContain("图书馆位于东区");
    expect(excerpt.length).toBeLessThanOrEqual(200);
  });
});

describe("buildSchoolRelationContext", () => {
  test("matches normalized multi-word entity names", () => {
    const relations = [
      { subject: "North Campus Library", predicate: "located_at", object: "Building B", evidence: "North Campus Library is located at Building B" },
      { subject: "Library", predicate: "offers", object: "Study Rooms", evidence: "Library offers Study Rooms" },
    ];
    const context = buildSchoolRelationContext(relations, "North-Campus Library reopened");
    expect(context).toContain("North Campus Library");
    expect(context).not.toContain("Library —offers");
  });
  test("requires both endpoints and supporting evidence to match the review post", () => {
    const relation = { subject: "图书馆", predicate: "located_at", object: "东区", evidence: "图书馆位于东区" };
    expect(buildSchoolRelationContext([relation], "图书馆位于东区开放")).toContain("图书馆");
    expect(buildSchoolRelationContext([relation], "图书馆开放，东区举行活动")).toBe("");
    expect(buildSchoolRelationContext([{ ...relation, evidence: "东区位于图书馆" }], "图书馆位于东区")).toBe("");
  });

  test("caps relation count and context characters", () => {
    const relations = Array.from({ length: 8 }, (_, index) => ({ subject: "图书馆", predicate: "located_at", object: `东区${index}`, evidence: "图书馆位于东区" }));
    const context = buildSchoolRelationContext(relations, "图书馆 东区", 100, 10000);
    expect(context.split("\n").filter(Boolean)).toHaveLength(5);
    expect(buildSchoolRelationContext(relations, "图书馆 东区", 5, 30).length).toBeLessThanOrEqual(30);
  });
});

describe("AI review retry policy", () => {
  test("retries transient failures up to five total attempts and waits with exponential backoff", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const result = await retryLlmReviewRequest(async (attempt) => {
      attempts = attempt;
      if (attempt < 5) throw Object.assign(new Error("temporary"), { retryAfterMs: 0 });
      return "ok";
    }, async (milliseconds) => { waits.push(milliseconds); });
    expect(result).toBe("ok");
    expect(attempts).toBe(5);
    expect(waits).toEqual([500, 1000, 2000, 4000]);
  });

  test("does not retry permanent errors and caps transient failures at five calls", async () => {
    let attempts = 0;
    await expect(retryLlmReviewRequest(async () => { attempts += 1; throw new Error("bad credentials"); }, async () => {})).rejects.toThrow("bad credentials");
    expect(attempts).toBe(1);
    attempts = 0;
    await expect(retryLlmReviewRequest(async () => { attempts += 1; throw Object.assign(new Error("busy"), { retryAfterMs: 0 }); }, async () => {})).rejects.toThrow("busy");
    expect(attempts).toBe(5);
  });
});


describe("withTenantReviewSlot", () => {
  test("queues work above the per-tenant concurrency instead of dropping it", async () => {
    const releases: Array<() => void> = [];
    const deferred = () => new Promise<void>((resolve) => { releases.push(resolve); });
    const first = withTenantReviewSlot("tenant-queue-a", deferred);
    const second = withTenantReviewSlot("tenant-queue-a", deferred);
    await Promise.resolve();

    let queuedSettled = false;
    const queued = withTenantReviewSlot("tenant-queue-a", async () => "queued-result").then((value) => {
      queuedSettled = true;
      return value;
    });
    const otherTenant = withTenantReviewSlot("tenant-queue-b", async () => "allowed");
    await expect(otherTenant).resolves.toBe("allowed");
    await Promise.resolve();
    // 并发已满时不再直接返回 null，而是排队等待。
    expect(queuedSettled).toBe(false);

    releases.shift()?.();
    await expect(queued).resolves.toBe("queued-result");

    releases.splice(0).forEach((release) => { release(); });
    await Promise.all([first, second]);
  });

  test("honours a custom concurrency limit", async () => {
    const releases: Array<() => void> = [];
    const deferred = () => new Promise<void>((resolve) => { releases.push(resolve); });
    const first = withTenantReviewSlot("tenant-limit-1", deferred, 1);
    await Promise.resolve();

    let secondSettled = false;
    const second = withTenantReviewSlot("tenant-limit-1", async () => "second", 1).then((value) => {
      secondSettled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondSettled).toBe(false);

    releases.shift()?.();
    await expect(second).resolves.toBe("second");
    await first;
  });

  test("degrades with a log when the tenant queue is full", async () => {
    const messages: string[] = [];
    const logger = { warn: (_context: unknown, message: string) => { messages.push(message); } } as unknown as FastifyBaseLogger;
    const never = () => new Promise<void>(() => {});
    const running = withTenantReviewSlot("tenant-queue-full", never, 1, { maxQueued: 0, logger });
    await Promise.resolve();

    await expect(withTenantReviewSlot("tenant-queue-full", async () => "dropped", 1, { maxQueued: 0, logger })).resolves.toBeNull();
    expect(messages).toEqual(["AI review queue overflow"]);
    void running;
  });

  test("drains earlier waiters before admitting a new arrival when the limit rises", async () => {
    const releases: Array<() => void> = [];
    const deferred = () => new Promise<void>((resolve) => { releases.push(resolve); });
    const running = withTenantReviewSlot("tenant-queue-drain", deferred, 1);
    await Promise.resolve();
    const older = withTenantReviewSlot("tenant-queue-drain", deferred, 1, { queueWaitMs: 5_000 });
    await Promise.resolve();

    let newerSettled = false;
    const newer = withTenantReviewSlot("tenant-queue-drain", async () => "newer", 2, { queueWaitMs: 5_000 }).then((value) => {
      newerSettled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // 并发从 1 调到 2：更早排队的请求先拿到空位，后来的仍在等。
    expect(releases.length).toBe(2);
    expect(newerSettled).toBe(false);

    releases.splice(0).forEach((release) => { release(); });
    await expect(newer).resolves.toBe("newer");
    await Promise.all([running, older]);
  });

  test("logs a timeout and lets the next waiter take the slot", async () => {
    const messages: string[] = [];
    const logger = { warn: (_context: unknown, message: string) => { messages.push(message); } } as unknown as FastifyBaseLogger;
    const releases: Array<() => void> = [];
    const deferred = () => new Promise<void>((resolve) => { releases.push(resolve); });
    const running = withTenantReviewSlot("tenant-queue-timeout", deferred, 1);
    await Promise.resolve();

    const timedOut = withTenantReviewSlot("tenant-queue-timeout", async () => "late", 1, { queueWaitMs: 10, logger });
    const next = withTenantReviewSlot("tenant-queue-timeout", async () => "granted", 1, { queueWaitMs: 1_000 });
    await expect(timedOut).resolves.toBeNull();
    expect(messages).toEqual(["AI review queue wait timeout"]);

    releases.shift()?.();
    await expect(next).resolves.toBe("granted");
    await running;
  });
});

describe("clampAiReviewConcurrency", () => {
  test("keeps the configured limit inside the supported range", () => {
    expect(clampAiReviewConcurrency(undefined)).toBe(2);
    expect(clampAiReviewConcurrency(0)).toBe(1);
    expect(clampAiReviewConcurrency(3.7)).toBe(3);
    expect(clampAiReviewConcurrency(99)).toBe(5);
  });
});
describe("global post review prompt", () => {
  test("covers euphemism and context-sensitive risks while avoiding guesses", () => {
    expect(postReviewSystemPrompt).toContain("委婉表达");
    expect(postReviewSystemPrompt).toContain("上下文指代");
    expect(postReviewSystemPrompt).toContain("不要猜测");
    expect(postReviewSystemPrompt).toContain("倾向 manual_review");
  });
});

describe("parsePostReviewAssessment", () => {
  test("exposes persisted shadow results as comparison-only analysis", () => {
    const shadowRecord = { id: "analysis-1", mode: "shadow", status: "completed", riskLevel: "high", confidence: 0.9, categories: ["privacy"], sensitiveFindings: [], suggestedAction: "manual_review", reasons: ["reason"], maskedText: null, rewrittenText: null, rejectionReason: null };
    expect(parsePostReviewAnalysisRecord(shadowRecord)).toEqual(expect.objectContaining({ mode: "shadow", status: "completed" }));
    expect(parsePostReviewAnalysisRecord({ ...shadowRecord, mode: "assist" })).toEqual(expect.objectContaining({ mode: "assist", status: "completed" }));
  });
  test("accepts legacy v1 shape and normalizes schemaVersion", () => {
    const parsed = parsePostReviewAssessment('{"riskLevel":"low","categories":[],"sensitiveFindings":[],"suggestedAction":"manual_review","reasons":["review"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}');
    expect(parsed?.schemaVersion).toBe(1);
    expect(parsePostReviewAssessment('{"schemaVersion":2,"riskLevel":"low","categories":[],"sensitiveFindings":[],"suggestedAction":"manual_review","reasons":["review"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toBeNull();
  });

  test("maps the legacy revise recommendation to human review", () => {
    const parsed = parsePostReviewAssessment('{"riskLevel":"medium","categories":[],"sensitiveFindings":[],"suggestedAction":"revise","reasons":["needs context"],"confidence":0.7,"maskedText":null,"rewrittenText":null,"rejectionReason":null}');
    expect(parsed?.suggestedAction).toBe("manual_review");
  });

  test("requires exact source grounding for findings, including Unicode", () => {
    const parsed = parsePostReviewAssessment('{"riskLevel":"low","categories":[],"sensitiveFindings":[{"type":"privacy","excerpt":"李雷🌱","reason":"reason"}],"suggestedAction":"manual_review","reasons":["free-form reason"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')!;
    expect(validatePostReviewEvidence("原文：李雷🌱。", parsed)).not.toBeNull();
    const invalidAssessment = {
      ...parsed!,
      sensitiveFindings: [{ type: "privacy", excerpt: "LiLei", reason: "name" }],
    };
    expect(validatePostReviewEvidence("LiLeis is not an exact token", invalidAssessment)).toBeNull();
    expect(validatePostReviewEvidence("Mention LiLei here", invalidAssessment)).not.toBeNull();
  });

  test("accepts only a bounded advisory assessment", () => {
    expect(parsePostReviewAssessment('{"riskLevel":"high","categories":["骚扰攻击"],"sensitiveFindings":[],"suggestedAction":"manual_review","reasons":["包含针对性攻击"],"confidence":0.92,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toEqual({
      schemaVersion: 1, riskLevel: "high", categories: ["骚扰攻击"], sensitiveFindings: [], suggestedAction: "manual_review", reasons: ["包含针对性攻击"], confidence: 0.92, maskedText: null, rewrittenText: null, rejectionReason: null,
    });
  });
  test("rejects malformed, unsupported, and out-of-range model output", () => {
    expect(parsePostReviewAssessment("not json")).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"reject","categories":["x"],"sensitiveFindings":[],"suggestedAction":"approve","reasons":["x"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"low","categories":["x"],"sensitiveFindings":[],"suggestedAction":"approve","reasons":["x"],"confidence":3,"maskedText":null,"rewrittenText":null,"rejectionReason":null}')).toBeNull();
    expect(parsePostReviewAssessment('{"riskLevel":"low","categories":["x"],"sensitiveFindings":[],"suggestedAction":"approve","reasons":["x"],"confidence":0.5,"maskedText":null,"rewrittenText":null,"rejectionReason":null,"decision":"approve"}')).toBeNull();
  });

  test("validates persisted audit detail before returning it", () => {
    expect(parsePersistedPostReviewDetail({ mode: "assist", status: "failed" })).toEqual({ mode: "assist", status: "failed" });
    expect(parsePersistedPostReviewDetail({ mode: "shadow", status: "completed", assessment: { riskLevel: "low", categories: [], sensitiveFindings: [], suggestedAction: "manual_review", reasons: ["review"], confidence: 0.8, maskedText: null, rewrittenText: null, rejectionReason: null } })).toEqual(expect.objectContaining({ mode: "shadow", status: "completed" }));
    expect(parsePersistedPostReviewDetail({ mode: "assist", status: "completed", assessment: { riskLevel: "low" } })).toBeNull();
  });
});

describe("readBoundedLlmResponse", () => {
  test("reads a response within the configured byte limit", async () => {
    const response = new Response("{\"ok\":true}");
    await expect(readBoundedLlmResponse(response, 32)).resolves.toBe("{\"ok\":true}");
  });
  test("rejects declared and streamed responses over the limit", async () => {
    await expect(readBoundedLlmResponse(new Response("12345", { headers: { "content-length": "5" } }), 4)).rejects.toThrow();
    await expect(readBoundedLlmResponse(new Response("12345"), 4)).rejects.toThrow();
    const noContentLength = new Response("12345");
    Object.defineProperty(noContentLength.headers, "get", { value: () => null });
    await expect(readBoundedLlmResponse(noContentLength, 4)).rejects.toThrow();
  });
});


describe("assertSafeLlmUrl", () => {
  test("allows public HTTPS service URLs", async () => {
    await expect(assertSafeLlmUrl("https://example.com/v1")).resolves.toBeInstanceOf(URL);
  });
  test("rejects non-HTTPS, local, and private-network endpoints", async () => {
    for (const url of ["http://api.example.com/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.0.0.8/v1", "https://192.168.1.8/v1", "https://[::1]/v1", "file:///etc/passwd"]) {
      await expect(assertSafeLlmUrl(url)).rejects.toThrow();
    }
  });
});

describe("llm output token budget", () => {
  test("keeps short inputs at the floor instead of a tiny fixed cap", () => {
    expect(llmOutputTokenBudget(0, { floor: 600 })).toBe(600);
    expect(llmOutputTokenBudget(30, { floor: 600, multiplier: 1.8, padding: 300 })).toBe(600);
  });

  test("scales with input length so long posts are not truncated", () => {
    const short = llmOutputTokenBudget(400, { floor: 1000, multiplier: 2.4, padding: 600 });
    const long = llmOutputTokenBudget(2000, { floor: 1000, multiplier: 2.4, padding: 600 });
    expect(short).toBe(1560);
    expect(long).toBe(4096);
    expect(long).toBeGreaterThan(short);
  });

  test("reads finish_reason and treats missing envelope as unknown", () => {
    expect(llmFinishReason({ choices: [{ finish_reason: "length" }] })).toBe("length");
    expect(llmFinishReason({ choices: [{ finish_reason: "stop" }] })).toBe("stop");
    expect(llmFinishReason(null)).toBeNull();
    expect(llmFinishReason({})).toBeNull();
  });
});
