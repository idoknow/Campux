import { describe, expect, test } from "bun:test";
import {
  LastTenantAdminRemovalError,
  assertTenantMembershipRemovalAllowed,
  assertTenantMembershipRoleChangeAllowed,
  buildTenantAdminUserIds,
  retryTransactionSerializationFailures,
} from "./tenant-membership-removal";

describe("assertTenantMembershipRemovalAllowed", () => {
  test("rejects removing the only tenant admin", () => {
    expect(() => assertTenantMembershipRemovalAllowed({ role: "admin", adminCount: 1 })).toThrow(LastTenantAdminRemovalError);
  });

  test("allows removing an admin when another admin remains", () => {
    expect(() => assertTenantMembershipRemovalAllowed({ role: "admin", adminCount: 2 })).not.toThrow();
  });

  test("allows removing non-admin memberships", () => {
    expect(() => assertTenantMembershipRemovalAllowed({ role: "reviewer", adminCount: 0 })).not.toThrow();
  });
});

describe("assertTenantMembershipRoleChangeAllowed", () => {
  test("rejects demoting the only admin", () => {
    expect(() => assertTenantMembershipRoleChangeAllowed({
      currentRole: "admin",
      nextRole: "reviewer",
      adminCount: 1,
    })).toThrow(LastTenantAdminRemovalError);
  });

  test("allows demoting an admin when another admin remains", () => {
    expect(() => assertTenantMembershipRoleChangeAllowed({
      currentRole: "admin",
      nextRole: "submitter",
      adminCount: 2,
    })).not.toThrow();
  });

  test("allows promotions and unchanged roles", () => {
    expect(() => assertTenantMembershipRoleChangeAllowed({
      currentRole: "reviewer",
      nextRole: "admin",
      adminCount: 1,
    })).not.toThrow();
    expect(() => assertTenantMembershipRoleChangeAllowed({
      currentRole: "admin",
      nextRole: "admin",
      adminCount: 1,
    })).not.toThrow();
  });
});

describe("buildTenantAdminUserIds", () => {
  test("always includes the creator even when there are no other admins", () => {
    expect(buildTenantAdminUserIds([], "creator-1")).toEqual(["creator-1"]);
  });

  test("deduplicates the creator and other admin ids", () => {
    expect(buildTenantAdminUserIds(["operator-1", "creator-1", "operator-1"], "creator-1"))
      .toEqual(["operator-1", "creator-1"]);
  });
});

describe("retryTransactionSerializationFailures", () => {
  test("retries serialization failures before returning the transaction result", async () => {
    let attempts = 0;
    const value = await retryTransactionSerializationFailures(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("serialization");
        }
        return "removed";
      },
      (error) => error instanceof Error && error.message === "serialization",
    );

    expect(value).toBe("removed");
    expect(attempts).toBe(3);
  });

  test("does not retry non-serialization failures", async () => {
    let attempts = 0;
    await expect(retryTransactionSerializationFailures(
      async () => {
        attempts += 1;
        throw new Error("permission denied");
      },
      () => false,
    )).rejects.toThrow("permission denied");
    expect(attempts).toBe(1);
  });
});
