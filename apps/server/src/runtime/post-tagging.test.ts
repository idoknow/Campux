import { describe, expect, test } from "bun:test";
import { buildLlmJsonRequestBody, chunkTagMaintenancePosts, extractLlmErrorMessage, mergeTagMaintenanceResults, parsePostTagMaintenanceJson, parsePostTagSuggestionJson, shouldFallbackReasoning, shouldRunTagClustering, shouldRunTagMaintenance, tagMaintenancePostStatuses } from "./post-tagging";
import type { PostTagMaintenanceResult } from "./post-tagging";

describe("post tag LLM JSON parsing", () => {
  test("parses tag suggestions and normalizes names", () => {
    const parsed = parsePostTagSuggestionJson(`
      {"selected":["#高考志愿"," 失物 招领 "],"create":[{"name":"#宿舍维修","description":"维修咨询","color":"#DBEAFE"}],"confidence":0.82}
    `);
    expect(parsed).not.toBeNull();
    expect(parsed?.selected).toEqual(["高考志愿", "失物 招领"]);
    expect("create" in (parsed ?? {})).toBe(false);
    expect(parsed?.confidence).toBe(0.82);
  });

  test("parses agent plan: create clusters drop undersized rows", () => {
    const parsed = parsePostTagMaintenanceJson(`
      {"create":[
        {"name":"高考志愿","description":"志愿填报","color":"bad","postIds":["p1","p2","p3","p4"],"confidence":0.93},
        {"name":"宿舍维修","description":"x","postIds":["p1","p2"]},
        {"name":"","description":"x","postIds":["p1","p2","p3"]}
      ]}
    `);
    expect(parsed).not.toBeNull();
    expect(parsed?.create).toHaveLength(1);
    expect(parsed?.create[0]?.name).toBe("高考志愿");
    expect(parsed?.create[0]?.description).toBe("志愿填报");
    expect(parsed?.create[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed?.create[0]?.postIds).toEqual(["p1", "p2", "p3", "p4"]);
    expect(parsed?.create[0]?.confidence).toBe(0.93);
  });

  test("create accepts the minimum cluster size of 3", () => {
    const parsed = parsePostTagMaintenanceJson(`
      {"create":[{"name":"失物招领","postIds":["p1","p2","p3"]}]}
    `);
    expect(parsed?.create).toHaveLength(1);
    expect(parsed?.create[0]?.postIds).toEqual(["p1", "p2", "p3"]);
  });

  test("parses merge ops and drops self/empty merges", () => {
    const parsed = parsePostTagMaintenanceJson(`
      {"merge":[
        {"from":["表白","#表白墙"],"into":"表白"},
        {"from":[],"into":"考研"},
        {"from":["旧活动"],"into":""}
      ]}
    `);
    expect(parsed?.merge).toHaveLength(1);
    expect(parsed?.merge[0]?.into).toBe("表白");
    // "表白" equals `into` so it is filtered out, leaving the normalized "表白墙"
    expect(parsed?.merge[0]?.from).toEqual(["表白墙"]);
  });

  test("parses assign ops and normalizes tag names", () => {
    const parsed = parsePostTagMaintenanceJson(`
      {"assign":[
        {"postId":"p1","tags":["#考研"," 失物招领 "]},
        {"postId":"","tags":["x"]},
        {"postId":"p2","tags":[]}
      ]}
    `);
    expect(parsed?.assign).toHaveLength(1);
    expect(parsed?.assign[0]?.postId).toBe("p1");
    expect(parsed?.assign[0]?.tags).toEqual(["考研", "失物招领"]);
  });

  test("returns empty buckets when fields are absent", () => {
    const parsed = parsePostTagMaintenanceJson(`{}`);
    expect(parsed).not.toBeNull();
    expect(parsed?.create).toEqual([]);
    expect(parsed?.merge).toEqual([]);
    expect(parsed?.assign).toEqual([]);
  });
});

describe("post tag maintenance gate", () => {
  const base = { enabled: true, mode: "llm", rules: { postTaggingEnabled: true, postTagMaintenanceEnabled: true } };

  test("maintenance runs when AI and maintenance are on", () => {
    expect(shouldRunTagMaintenance(base)).toBe(true);
    expect(shouldRunTagMaintenance(null)).toBe(false);
    expect(shouldRunTagMaintenance({ ...base, enabled: false })).toBe(false);
    expect(shouldRunTagMaintenance({ ...base, mode: "local" })).toBe(false);
    expect(shouldRunTagMaintenance({ ...base, rules: { postTaggingEnabled: true, postTagMaintenanceEnabled: false } })).toBe(false);
  });

  test("clustering stops burning tokens when auto tagging is off, archiving still runs", () => {
    const taggingOff = { ...base, rules: { postTaggingEnabled: false, postTagMaintenanceEnabled: true } };
    expect(shouldRunTagMaintenance(taggingOff)).toBe(true);
    expect(shouldRunTagClustering(taggingOff)).toBe(false);
  });

  test("clusters only posts that are still visible on the wall", () => {
    expect([...tagMaintenancePostStatuses]).toContain("published");
    expect([...tagMaintenancePostStatuses]).toContain("pending_recall");
    expect([...tagMaintenancePostStatuses]).not.toContain("approved");
    expect([...tagMaintenancePostStatuses]).not.toContain("rejected");
    expect([...tagMaintenancePostStatuses]).not.toContain("cancelled");
  });
});

describe("tag maintenance batching", () => {
  test("splits the wall into fixed-size batches so the plan JSON stays under max_tokens", () => {
    const posts = Array.from({ length: 78 }, (_, index) => `p${index}`);
    const batches = chunkTagMaintenancePosts(posts);
    expect(batches.map((batch) => batch.length)).toEqual([30, 30, 18]);
    expect(batches.flat()).toEqual(posts);
  });

  test("keeps an exact multiple as full batches and an empty wall as no batches", () => {
    expect(chunkTagMaintenancePosts(Array.from({ length: 60 }, (_, i) => i)).map((b) => b.length)).toEqual([30, 30]);
    expect(chunkTagMaintenancePosts([])).toEqual([]);
    expect(chunkTagMaintenancePosts([1, 2, 3], 2).map((b) => b.length)).toEqual([2, 1]);
  });

  test("falls back to the default size for invalid input", () => {
    expect(chunkTagMaintenancePosts(Array.from({ length: 31 }, (_, i) => i), 0).map((b) => b.length)).toEqual([30, 1]);
    expect(chunkTagMaintenancePosts(Array.from({ length: 31 }, (_, i) => i), Number.NaN).map((b) => b.length)).toEqual([30, 1]);
  });

  test("dedupes merged entries when combining batch results", () => {
    const first: PostTagMaintenanceResult = { created: ["A"], merged: [{ from: ["旧名", "别名"], into: "规范" }], archived: [], deleted: [], assigned: [{ tag: "A", postIds: ["p1"] }] };
    const second: PostTagMaintenanceResult = { created: ["B"], merged: [{ from: ["别名", "旧名"], into: "规范" }], archived: ["x"], deleted: [], assigned: [{ tag: "B", postIds: ["p2"] }] };

    const merged = mergeTagMaintenanceResults(first, second);
    expect(merged.created).toEqual(["A", "B"]);
    expect(merged.merged).toHaveLength(1);
    expect(merged.archived).toEqual(["x"]);
    expect(merged.assigned).toHaveLength(2);
  });
});

describe("reasoning_effort fallback", () => {
  test("falls back on any 4xx except auth/throttle, and only once", () => {
    expect(shouldFallbackReasoning({ status: 400, alreadyFellBack: false })).toBe(true);
    expect(shouldFallbackReasoning({ status: 422, alreadyFellBack: false })).toBe(true);
    expect(shouldFallbackReasoning({ status: 404, alreadyFellBack: false })).toBe(true);
    expect(shouldFallbackReasoning({ status: 400, alreadyFellBack: true })).toBe(false);
    expect(shouldFallbackReasoning({ status: 500, alreadyFellBack: false })).toBe(false);
    expect(shouldFallbackReasoning({ status: 502, alreadyFellBack: false })).toBe(false);
    expect(shouldFallbackReasoning({ status: 401, alreadyFellBack: false })).toBe(false);
    expect(shouldFallbackReasoning({ status: 429, alreadyFellBack: false })).toBe(false);
  });

  test("reads error text from FastAPI detail, string errors and plain text", () => {
    const fastapi = '{"detail":[{"loc":["body","reasoning_effort"],"msg":"extra fields not permitted"}]}';
    expect(extractLlmErrorMessage(fastapi, JSON.parse(fastapi))).toContain("extra fields not permitted");

    const stringError = '{"error":"Unrecognized request argument: reasoning_effort"}';
    expect(extractLlmErrorMessage(stringError, JSON.parse(stringError))).toContain("Unrecognized request argument");

    const objectError = '{"error":{"message":"GLM-5.3 is a thinking-only model"}}';
    expect(extractLlmErrorMessage(objectError, JSON.parse(objectError))).toContain("thinking-only");

    expect(extractLlmErrorMessage("Bad Gateway")).toBe("Bad Gateway");
  });

  test("only adds reasoning_effort when thinking can be disabled", () => {
    const base = { model: "deepseek-v4.1-flash", maxTokens: 1000, systemPrompt: "sys", userPayload: "{}" };
    expect(buildLlmJsonRequestBody({ ...base, reasoningOff: true })).toMatchObject({
      reasoning_effort: "none",
      max_tokens: 1000,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "{}" },
      ],
    });
    expect(buildLlmJsonRequestBody({ ...base, reasoningOff: false })).not.toHaveProperty("reasoning_effort");
    expect(buildLlmJsonRequestBody({ ...base, reasoningOff: false, temperature: 0.5 })).toMatchObject({ temperature: 0.5 });
  });
});
