/**
 * Regression test: switching a tenant's operate mode must not touch accounts.
 *
 * `operate_mode` lives in tenant_metadata; the PATCH handler only upserts that
 * row, so users, memberships, passwords and sessions must be byte-for-byte
 * unchanged. This suite is opt-in (needs a throwaway DATABASE_URL):
 *
 *   CAMPUX_E2E_DB=1 bun test apps/server/src/routes/operate-mode-account.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { loadConfig } from "@campux/config";
import { prisma } from "../lib/prisma";
import { hashToken, sessionCookieName } from "../lib/auth";
import { registerMetadataRoutes } from "./metadata";

const runE2E = process.env.CAMPUX_E2E_DB === "1";
const maybeDescribe = runE2E ? describe : describe.skip;

maybeDescribe("operate mode switch preserves accounts", () => {
  let tenantId = "";
  let userId = "";
  let token = "";

  beforeAll(async () => {
    if (!runE2E) return;
    tenantId = randomUUID();
    userId = randomUUID();
    await prisma.tenant.create({
      data: { id: tenantId, slug: `test-${tenantId.slice(0, 8)}`, name: "E2E Wall", readyAt: new Date() },
    });
    await prisma.user.create({
      data: { id: userId, qqUin: BigInt(Date.now()), passwordHash: "hash-before" },
    });
    await prisma.tenantMembership.create({
      data: { id: randomUUID(), tenantId, userId, role: "admin" },
    });
    token = randomUUID();
    await prisma.accountSession.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: hashToken(token),
        selectedTenantId: tenantId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
  });

  test("PATCH operateMode keeps user, memberships and sessions unchanged", async () => {
    if (!runE2E) return;

    const app = Fastify();
    registerMetadataRoutes(app, loadConfig());
    await app.ready();

    const beforeUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: true },
    });
    const sessionsBefore = await prisma.accountSession.count({ where: { userId } });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/admin/tenant/metadata",
      payload: { operateMode: "manual" },
      headers: { cookie: `${sessionCookieName}=${encodeURIComponent(token)}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().operateMode).toBe("manual");

    const afterUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: true },
    });
    const sessionsAfter = await prisma.accountSession.count({ where: { userId } });

    expect(afterUser.passwordHash).toBe(beforeUser.passwordHash);
    expect(afterUser.qqUin).toBe(beforeUser.qqUin);
    expect(afterUser.memberships.map((m) => m.role)).toEqual(beforeUser.memberships.map((m) => m.role));
    expect(sessionsAfter).toBe(sessionsBefore);

    await app.close();
  });

  afterAll(async () => {
    if (!runE2E) return;
    await prisma.accountSession.deleteMany({ where: { userId } });
    await prisma.tenantMembership.deleteMany({ where: { tenantId } });
    await prisma.tenantMetadata.deleteMany({ where: { tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
});
