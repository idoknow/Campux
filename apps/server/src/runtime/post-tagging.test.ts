import { describe, expect, test } from "bun:test";
import { parsePostTagMaintenanceJson, parsePostTagSuggestionJson } from "./post-tagging";

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
