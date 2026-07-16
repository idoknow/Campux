import { describe, expect, test } from "bun:test";
import { writeAuditLog } from "./audit";

describe("writeAuditLog", () => {
  test("uses the provided transaction client so audit and business writes can commit atomically", async () => {
    let createdData: unknown;
    const transactionClient = {
      auditLog: {
        create: async ({ data }: { data: unknown }) => {
          createdData = data;
          return { id: "audit-1" };
        },
      },
    };

    await writeAuditLog({
      tenantId: "tenant-1",
      actorId: "user-1",
      action: "tenant.lifecycle.update",
      targetType: "tenant",
      targetId: "tenant-1",
      detail: { status: "active" },
    }, transactionClient as never);

    expect(createdData).toEqual({
      tenantId: "tenant-1",
      actorId: "user-1",
      action: "tenant.lifecycle.update",
      targetType: "tenant",
      targetId: "tenant-1",
      detail: { status: "active" },
    });
  });
});
