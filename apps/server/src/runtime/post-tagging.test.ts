import { describe, expect, test } from "bun:test";
import { parsePostTagMaintenanceJson, parsePostTagSuggestionJson } from "./post-tagging";

describe("post tag LLM JSON parsing", () => {
  test("parses tag suggestions and normalizes names", () => {
    const parsed = parsePostTagSuggestionJson(`
      {"selected":["#高考志愿"," 失物 招领 "],"create":[{"name":"#宿舍维修","description":"维修咨询","color":"#DBEAFE"}],"confidence":0.82}
    `);
    expect(parsed).not.toBeNull();
    expect(parsed?.selected).toEqual(["高考志愿", "失物 招领"]);
    expect(parsed?.create[0]).toEqual({ name: "宿舍维修", description: "维修咨询", color: "#dbeafe" });
    expect(parsed?.confidence).toBe(0.82);
  });

  test("parses maintenance actions and drops invalid create rows", () => {
    const parsed = parsePostTagMaintenanceJson(`
      {"create":[{"name":"高考志愿","description":"志愿填报","color":"bad"},{"name":"","description":"x"}],"archive":["旧活动"],"delete":["空标签"]}
    `);
    expect(parsed).not.toBeNull();
    expect(parsed?.create[0]?.name).toBe("高考志愿");
    expect(parsed?.create[0]?.description).toBe("志愿填报");
    expect(parsed?.create[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(parsed?.archive).toEqual(["旧活动"]);
    expect(parsed?.delete).toEqual(["空标签"]);
  });
});
