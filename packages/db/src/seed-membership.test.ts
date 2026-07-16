import { describe, expect, test } from "bun:test";
import { resolveMembershipRoleForSeed } from "./seed-membership";

describe("resolveMembershipRoleForSeed", () => {
  test("never demotes an existing admin during reseeding", () => {
    expect(resolveMembershipRoleForSeed("admin", "reviewer")).toBe("admin");
    expect(resolveMembershipRoleForSeed("admin", "submitter")).toBe("admin");
  });

  test("restores the declared role for existing non-admin fixtures", () => {
    expect(resolveMembershipRoleForSeed("submitter", "reviewer")).toBe("reviewer");
    expect(resolveMembershipRoleForSeed("reviewer", "submitter")).toBe("submitter");
  });

  test("uses the declared role for a new membership and permits admin promotion", () => {
    expect(resolveMembershipRoleForSeed(undefined, "submitter")).toBe("submitter");
    expect(resolveMembershipRoleForSeed("reviewer", "admin")).toBe("admin");
  });
});
