import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isTenantRuntimeActiveStatus, tenantRuntimeRelationFilter } from "../lib/tenant-runtime";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("inactive tenant runtime policy", () => {
  test("only active tenants may run jobs or interactions", () => {
    expect(isTenantRuntimeActiveStatus("active")).toBe(true);
    expect(isTenantRuntimeActiveStatus("paused")).toBe(false);
    expect(isTenantRuntimeActiveStatus("archived")).toBe(false);
    expect(tenantRuntimeRelationFilter).toEqual({ status: "active" });
  });

  test("HTTP and OneBot interaction entry points share the active-tenant gate", () => {
    const auth = source("../lib/auth.ts");
    const botWorkflows = source("../lib/bot-workflows.ts");
    const onebot = source("./onebot.ts");
    const system = source("../routes/system.ts");

    expect(auth).toContain("isTenantRuntimeActiveStatus(context.selectedTenant.status)");
    expect(auth).not.toContain("!isTenantRuntimeActiveStatus(context.selectedTenant.status) && !isSystemOperatorContext(context)");
    expect(botWorkflows).toContain("tenant: tenantRuntimeRelationFilter");
    expect(botWorkflows.match(/runWithActiveTenantLease/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(onebot).toContain("ensureConnectionTenantActive");
    expect(onebot).toContain("disconnectTenant");
    expect(system).toContain("oneBot?.disconnectTenant(params.tenantId)");
    expect(source("./publishing.ts")).toContain("runPublishSideEffectWithActiveTenantLease");
  });

  test("every tenant-scoped periodic scan selects active tenants", () => {
    const guardedSources = [
      source("../lib/qzone-cookies.ts"),
      source("./qzone-post-metrics.ts"),
      source("./bot-friend-snapshots.ts"),
      source("./followed-post-comments.ts"),
      source("./review-queue.ts"),
      source("./publishing.ts"),
      source("./publish-batching.ts"),
      source("./post-tagging.ts"),
    ];

    for (const runtimeSource of guardedSources) {
      expect(runtimeSource).toContain("tenantRuntimeRelationFilter");
    }
    expect(source("./post-tagging.ts").match(/isTenantRuntimeActive/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(source("./qzone-post-metrics.ts").match(/isTenantRuntimeActive/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source("../lib/qzone-cookies.ts")).toContain("runWithActiveTenantLease");
  });

  test("all irreversible direct and AI egress is serialized with tenant deactivation", () => {
    const botWorkflows = source("../lib/bot-workflows.ts");
    const publishing = source("./publishing.ts");
    const privatePostingAi = source("../lib/private-posting-ai.ts");

    expect(botWorkflows).toContain("runWithActiveTenantLease(prisma, bot.tenantId");
    expect(publishing).toContain("runWithActiveTenantLease(prisma, tenantId");
    expect(privatePostingAi).toContain("runWithActiveTenantLease(prisma, input.tenantId");
  });

  test("interaction writes, scheduled egress, and lifecycle transitions use durable tenant serialization", () => {
    expect(source("./onebot.ts")).toContain("lockActiveTenantRuntime(tx, bot.tenantId)");
    expect(source("../lib/bot-workflows.ts").match(/runWithActiveTenantLease/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(source("./post-tagging.ts")).toContain("runWithActiveTenantLease(prisma, options.tenantId");
    expect(source("../lib/qzone-cookies.ts")).toContain("runWithActiveTenantLease(prisma, session.botAccount.tenantId");
    expect(source("./qzone-post-metrics.ts")).toContain("runWithActiveTenantLease(prisma, attempt.tenantId");
    expect(source("./bot-friend-snapshots.ts")).toContain("runWithActiveTenantLease(prisma, bot.tenantId");

    const system = source("../routes/system.ts");
    expect(system).toContain("lockTenantRuntime(tx, params.tenantId)");
    expect(system).toContain("currentStatus !== body.status");
  });

  test("late-admission HTTP and protocol egress is serialized at the irreversible boundary", () => {
    expect(source("../routes/posts.ts")).toContain("lockActiveTenantRuntime(tx, context.selectedTenant.id)");
    expect(source("./ai-settings.ts")).toContain("runWithActiveTenantLease(prisma, tenantId");
    expect(source("../lib/qzone-login.ts").match(/runWithActiveTenantLease/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source("../routes/admin.ts").match(/runWithActiveTenantLease/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source("./onebot.ts")).toContain("runWithActiveTenantLease(prisma, connection.tenantId");
  });

  test("successful provider results are persisted with the same tenant lease transaction", () => {
    const publishing = source("./publishing.ts");
    expect(publishing).toContain("operation: (transaction: Prisma.TransactionClient)");
    expect(publishing).toContain("await transaction.publishAttempt.update");
    expect(publishing).toContain("await transaction.postLog.create");
    const botWorkflows = source("../lib/bot-workflows.ts");
    expect(botWorkflows).toContain("const result = await publishToQZone(qzoneInput)");
    expect(botWorkflows).toContain("await transaction.botAccount.update");
    expect(source("./publish-summary.ts")).toContain("readTenantAiSettings(options.tenantId, options.transaction)");
    expect(source("./publishing.ts")).toContain("generatePublishSummary({ tenantId, text, logger, transaction })");
    const metrics = source("./qzone-post-metrics.ts");
    expect(metrics).not.toContain("isTenantRuntimeActive(prisma, attempt.tenantId)");
    expect(metrics).toContain("upsertMetricFailure(\n        attempt,\n        qzoneTid");
  });

  test("recall, review writes, attachment egress, and disconnect cleanup are fenced", () => {
    const recall = source("../lib/post-recall.ts");
    expect(recall).toContain("runWithActiveTenantLease(prisma, tenantId");
    expect(recall).not.toContain("await prisma.publishAttempt.update");
    expect(recall).not.toContain("await prisma.postLog.create");

    const review = source("../routes/review.ts");
    expect(review.match(/runWithActiveTenantLease/g)?.length ?? 0).toBeGreaterThanOrEqual(4);

    const onebot = source("./onebot.ts");
    expect(onebot).toContain("pending.connection !== connection");
    expect(onebot).toContain("fetchPrivatePostImageWithLease");
    expect(onebot).toContain("setQZoneEmotionPrivate({");
    expect(onebot).toContain("runWithActiveTenantLease(prisma, bot.tenantId");

    const qzoneLogin = source("../lib/qzone-login.ts");
    expect(qzoneLogin).toContain("return { committed: true as const");
    expect(qzoneLogin.indexOf("task.status = \"succeeded\"")).toBeGreaterThan(qzoneLogin.indexOf("if (!leased.active)"));
  });
});
