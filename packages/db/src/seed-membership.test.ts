import { describe, expect, test } from "bun:test";
import { membershipRoleUpdateForSeed } from "./seed-membership";

describe("membershipRoleUpdateForSeed", () => {
  test("never demotes an existing membership during reseeding", () => {
    expect(membershipRoleUpdateForSeed("submitter")).toEqual({});
    expect(membershipRoleUpdateForSeed("reviewer")).toEqual({});
  });

  test("allows a safe promotion to admin during reseeding", () => {
    expect(membershipRoleUpdateForSeed("admin")).toEqual({ role: "admin" });
  });
});