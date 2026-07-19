import { describe, expect, it } from "bun:test";
import { parsePostDisplayIdFilter } from "./post-display-id-filter";

describe("parsePostDisplayIdFilter", () => {
  it("parses normal post display ids", () => {
    expect(parsePostDisplayIdFilter("6962")).toBe(6962);
  });

  it("ignores QQ-sized numeric keywords that do not fit PostgreSQL INT4", () => {
    expect(parsePostDisplayIdFilter("2683086098")).toBeNull();
  });

  it("ignores non-numeric keywords", () => {
    expect(parsePostDisplayIdFilter("关键词")).toBeNull();
  });
});
