import { describe, expect, test } from "bun:test";
import { parseDeployMode, slugFromWallName } from "./deploy-mode";

describe("parseDeployMode", () => {
  test("recognizes single and multi", () => {
    expect(parseDeployMode("single")).toBe("single");
    expect(parseDeployMode("multi")).toBe("multi");
  });

  test("defaults unknown/legacy values to multi for backward compatibility", () => {
    expect(parseDeployMode(undefined)).toBe("multi");
    expect(parseDeployMode(null)).toBe("multi");
    expect(parseDeployMode("nonsense")).toBe("multi");
    expect(parseDeployMode(123)).toBe("multi");
  });
});

describe("slugFromWallName", () => {
  const slugShape = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

  test("produces a schema-valid slug from an ASCII name", () => {
    const slug = slugFromWallName("Guangzhou Wall", 1234);
    expect(slug).toBe("guangzhou-wall-1234");
    expect(slug).toMatch(slugShape);
  });

  test("falls back to wall-NNNN for non-ASCII (e.g. Chinese) names", () => {
    const slug = slugFromWallName("广州大学校园墙", 5678);
    expect(slug).toBe("wall-5678");
    expect(slug).toMatch(slugShape);
  });

  test("never ends with a trailing hyphen even when the name has trailing symbols", () => {
    const slug = slugFromWallName("Hello!!!", 4321);
    expect(slug).toBe("hello-4321");
    expect(slug).toMatch(slugShape);
  });

  test("mixed ASCII + Chinese keeps the ASCII portion", () => {
    const slug = slugFromWallName("GZHU 校园墙", 9999);
    expect(slug).toBe("gzhu-9999");
    expect(slug).toMatch(slugShape);
  });
});
