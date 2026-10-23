import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";

const entityTypes = ["location", "class", "person_alias", "organization", "topic", "risky_phrase", "service"] as const;
const sensitivities = ["normal", "sensitive", "blocked"] as const;
const entityIdSchema = z.object({ id: z.string().uuid() });
const entitySchema = z.object({
  type: z.enum(entityTypes),
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  confidence: z.number().min(0).max(1).default(1),
  sensitivity: z.enum(sensitivities).default("normal"),
});

export function registerAiReviewRoutes(app: FastifyInstance) {
  app.get("/api/admin/ai-review/entities", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const entities = await prisma.schoolEntity.findMany({
      where: { tenantId: context.selectedTenant.id },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return { entities };
  });

  app.post("/api/admin/ai-review/entities", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const input = entitySchema.parse(request.body);
    const saved = await runWithActiveTenantLease(prisma, context.selectedTenant.id, (tx) => tx.schoolEntity.upsert({
      where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: input.name } },
      create: { tenantId: context.selectedTenant.id, ...input, source: "admin" },
      update: { ...input, source: "admin" },
    }));
    if (!saved.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    const entity = saved.value;
    await writeAuditLog({ tenantId: context.selectedTenant.id, actorId: context.user.id, action: "tenant.ai_review.entity.upsert", targetType: "school_entity", targetId: entity.id, detail: { type: entity.type, sensitivity: entity.sensitivity } });
    return { entity };
  });

  app.delete("/api/admin/ai-review/entities/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const { id } = entityIdSchema.parse(request.params);
    const result = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => transaction.schoolEntity.deleteMany({ where: { id, tenantId: context.selectedTenant.id } }));
    if (!result.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    if (result.value.count === 0) return reply.code(404).send({ message: "实体不存在" });
    await writeAuditLog({ tenantId: context.selectedTenant.id, actorId: context.user.id, action: "tenant.ai_review.entity.delete", targetType: "school_entity", targetId: id });
    return { ok: true };
  });

  app.get("/api/admin/ai-review/snapshots", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const snapshots = await prisma.schoolModelSnapshot.findMany({ where: { tenantId: context.selectedTenant.id }, orderBy: { version: "desc" }, take: 50, select: { id: true, version: true, status: true, summary: true, createdAt: true, metrics: true } });
    return { snapshots };
  });

  app.post("/api/admin/ai-review/snapshots/refresh", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const tenantId = context.selectedTenant.id;
    const [entities, feedback, settings] = await Promise.all([
      prisma.schoolEntity.findMany({ where: { tenantId }, orderBy: [{ sensitivity: "desc" }, { updatedAt: "desc" }], take: 500, select: { type: true, name: true, aliases: true, sensitivity: true, confidence: true, source: true } }),
      prisma.aiFeedback.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 500, select: { humanAction: true, matched: true, humanComment: true, aiAction: true } }),
      prisma.tenantAiSettings.findUnique({ where: { tenantId }, select: { rules: true } }),
    ]);
    const snap = await runWithActiveTenantLease(prisma, tenantId, async (tx) => {
      const latest = await tx.schoolModelSnapshot.findFirst({ where: { tenantId }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.schoolModelSnapshot.updateMany({ where: { tenantId }, data: { status: "superseded" } });
      const counts = feedback.reduce((acc, item) => { acc.total += 1; if (item.matched) acc.matched += 1; return acc; }, { total: 0, matched: 0 });
      return tx.schoolModelSnapshot.create({ data: {
        tenantId, version: (latest?.version ?? 0) + 1, status: "active",
        summary: `校园审核上下文快照：收录 ${entities.length} 个管理员维护实体和 ${feedback.length} 条人工反馈。`,
        entities: JSON.parse(JSON.stringify(entities)), riskMemory: JSON.parse(JSON.stringify(feedback)),
        rules: JSON.parse(JSON.stringify((settings?.rules as Record<string, unknown> | null)?.aiReviewRules ?? {})),
        metrics: counts,
      } });
    });
    if (!snap.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    await writeAuditLog({ tenantId, actorId: context.user.id, action: "tenant.ai_review.snapshot.refresh", targetType: "school_model_snapshot", targetId: snap.value.id, detail: { version: snap.value.version, entityCount: entities.length, feedbackCount: feedback.length } });
    return { snapshot: snap.value };
  });
  app.get("/api/admin/ai-review/metrics", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const tenantId = context.selectedTenant.id;
    const [total, byStatus, feedback] = await Promise.all([
      prisma.postAiAnalysis.count({ where: { tenantId } }),
      prisma.postAiAnalysis.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } }),
      prisma.aiFeedback.groupBy({ by: ["matched"], where: { tenantId }, _count: { _all: true } }),
    ]);
    return { total, byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])), feedback: Object.fromEntries(feedback.map((row) => [row.matched ? "matched" : "overridden", row._count._all])) };
  });
}
