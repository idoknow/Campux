import { describe, expect, test } from "bun:test";
import {
  LastTenantAdminRemovalError,
  OperationsAdminAdminRoleProtectedError,
  TenantAdminRequiredError,
  TransactionSerializationRetriesExhaustedError,
  assertTenantActivationAllowed,
  assertTenantAdminMembershipRemovalAllowed,
  assertTenantAdminRoleChangeAllowed,
  assertTenantMembershipRemovalAllowed,
  assertTenantMembershipRoleChangeAllowed,
  buildTenantAdminUserIds,
  retryTransactionSerializationFailures,
  tenantAdminInvariantErrorResponse,
  updateTenantAfterAdminCheck,
} from "./tenant-membership-removal";

describe("assertTenantActivationAllowed", () => {
  test("rejects activating a tenant without an admin", () => {
    expect(() => assertTenantActivationAllowed(0)).toThrow(TenantAdminRequiredError);
  });

  test("allows activating a tenant with an admin", () => {
    expect(() => assertTenantActivationAllowed(1)).not.toThrow();
  });
});

describe("updateTenantAfterAdminCheck", () => {
  test("does not write the active status when the transaction sees no admin", async () => {
    let updated = false;
    await expect(updateTenantAfterAdminCheck({
      countAdmins: async () => 0,
      updateTenant: async () => {
        updated = true;
        return "active";
      },
    })).rejects.toBeInstanceOf(TenantAdminRequiredError);
    expect(updated).toBe(false);
  });

  test("writes the active status after the transaction sees an admin", async () => {
    const events: string[] = [];
    const result = await updateTenantAfterAdminCheck({
      countAdmins: async () => {
        events.push("count");
        return 1;
      },
      updateTenant: async () => {
        events.push("update");
        return "active";
      },
    });

    expect(result).toBe("active");
    expect(events).toEqual(["count", "update"]);
  });
});

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

describe("assertTenantAdminRoleChangeAllowed / assertTenantAdminMembershipRemovalAllowed", () => {
  const base = {
    actorUserId: "actor-1",
    targetUserId: "ops-admin-1",
    targetSystemRole: "operations_admin" as const,
    adminCount: 2,
  };

  test("rejects a peer admin demoting an operations admin", () => {
    expect(() => assertTenantAdminRoleChangeAllowed({
      ...base,
      actorSystemRole: null,
      currentRole: "admin",
      nextRole: "submitter",
    })).toThrow(OperationsAdminAdminRoleProtectedError);
    expect(() => assertTenantAdminMembershipRemovalAllowed({
      ...base,
      actorSystemRole: null,
      role: "admin",
    })).toThrow(OperationsAdminAdminRoleProtectedError);
  });

  test("rejects another operations admin demoting an operations admin", () => {
    expect(() => assertTenantAdminRoleChangeAllowed({
      ...base,
      actorSystemRole: "operations_admin",
      currentRole: "admin",
      nextRole: "submitter",
    })).toThrow(OperationsAdminAdminRoleProtectedError);
  });

  test("allows a system operator to demote or remove an operations admin", () => {
    expect(() => assertTenantAdminRoleChangeAllowed({
      ...base,
      actorSystemRole: "system_operator",
      currentRole: "admin",
      nextRole: "submitter",
    })).not.toThrow();
    expect(() => assertTenantAdminMembershipRemovalAllowed({
      ...base,
      actorSystemRole: "system_operator",
      role: "admin",
    })).not.toThrow();
  });

  test("allows the operations admin to change their own admin membership", () => {
    expect(() => assertTenantAdminRoleChangeAllowed({
      ...base,
      actorUserId: "ops-admin-1",
      actorSystemRole: "operations_admin",
      currentRole: "admin",
      nextRole: "submitter",
    })).not.toThrow();
  });

  test("still rejects demoting the last admin regardless of platform identity", () => {
    expect(() => assertTenantAdminRoleChangeAllowed({
      ...base,
      adminCount: 1,
      actorSystemRole: "system_operator",
      currentRole: "admin",
      nextRole: "submitter",
    })).toThrow(LastTenantAdminRemovalError);
  });

  test("allows peer admins to demote non-operations-admin members", () => {
    expect(() => assertTenantAdminRoleChangeAllowed({
      ...base,
      targetUserId: "plain-admin-1",
      targetSystemRole: null,
      actorSystemRole: null,
      currentRole: "admin",
      nextRole: "submitter",
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

  test("turns exhausted serialization retries into a 409 response contract", async () => {
    let attempts = 0;
    let caught: unknown;
    try {
      await retryTransactionSerializationFailures(
        async () => {
          attempts += 1;
          throw new Error("serialization");
        },
        (error) => error instanceof Error && error.message === "serialization",
      );
    } catch (error) {
      caught = error;
    }

    expect(attempts).toBe(3);
    expect(caught).toBeInstanceOf(TransactionSerializationRetriesExhaustedError);
    expect(tenantAdminInvariantErrorResponse(caught)).toEqual({
      statusCode: 409,
      code: "TENANT_ADMIN_CONCURRENT_UPDATE",
      message: "管理员状态发生并发变化，请刷新后重试",
    });
  });
});
