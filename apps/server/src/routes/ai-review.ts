import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { inferCandidateSensitivity, mergeEntityEvidence, refreshTenantSchoolModel } from "../runtime/school-model-refresh";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";

export const entityTypes = ["location", "class", "person_alias", "organization", "topic", "risky_phrase", "service"] as const;
const sensitivities = ["normal", "sensitive", "blocked"] as const;
const entityIdSchema = z.object({ id: z.string().uuid() });
const entityEvidenceSchema = z.object({ type: z.enum(entityTypes), name: z.string().trim().min(1).max(120), analysisId: z.string().uuid(), confidence: z.number().min(0).max(1).default(0.5), sensitivity: z.enum(sensitivities).optional() });
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
    const tenantId = context.selectedTenant.id;
    const entities = await prisma.schoolEntity.findMany({ where: { tenantId }, orderBy: [{ type: "asc" }, { name: "asc" }] });
    return { entities };
  });

  app.post("/api/admin/ai-review/entities/evidence", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const input = entityEvidenceSchema.parse(request.body);
    const analysis = await prisma.postAiAnalysis.findFirst({ where: { id: input.analysisId, tenantId: context.selectedTenant.id, status: "completed" }, select: { id: true, postId: true, confidence: true, sensitiveFindings: true } });
    const finding = Array.isArray(analysis?.sensitiveFindings) ? analysis!.sensitiveFindings.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).excerpt === input.name) : undefined;
    if (!analysis || !finding) return reply.code(404).send({ message: "未找到对应 AI 识别证据" });
    const findingType = (finding as { type: string }).type;
    if (!entityTypes.includes(findingType as (typeof entityTypes)[number]) || findingType !== input.type) return reply.code(400).send({ message: "实体类型与 AI 识别结果不一致" });
    const inferredSensitivity = inferCandidateSensitivity({ ...(finding as { type: string; excerpt: string; reason: string }), sensitivity: undefined });
    const evidence = { analysisId: analysis.id, postId: analysis.postId, type: input.type, name: input.name, sensitivity: inferredSensitivity, confidence: input.confidence ?? analysis.confidence ?? 0.5 };
    const candidateName = `candidate:${input.name}`;
    const existingCandidate = await prisma.schoolEntity.findUnique({ where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: candidateName } }, select: { evidence: true, confidence: true } });
    const merged = mergeEntityEvidence(existingCandidate?.evidence, evidence);
    if (!merged.promoted || inferredSensitivity !== "normal") {
      const candidate = await runWithActiveTenantLease(prisma, context.selectedTenant.id, (tx) => tx.schoolEntity.upsert({
        where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: candidateName } },
        create: { tenantId: context.selectedTenant.id, type: input.type, name: candidateName, aliases: [], confidence: merged.confidence, sensitivity: inferredSensitivity, source: "ai_candidate", evidence: merged.evidence },
        update: { evidence: merged.evidence, confidence: Math.max(existingCandidate?.confidence ?? 0, merged.confidence), sensitivity: inferredSensitivity },
      }));
      if (!candidate.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
      await writeAuditLog({ tenantId: context.selectedTenant.id, actorId: context.user.id, action: "tenant.ai_review.entity.evidence", targetType: "school_entity", targetId: candidate.value.id, detail: { type: input.type, sensitivity: inferredSensitivity, evidenceCount: merged.evidence.length } });
      return { entity: candidate.value, evidenceCount: merged.evidence.length, promoted: false };
    }
    const existingEntity = await prisma.schoolEntity.findUnique({ where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: input.name } }, select: { evidence: true, confidence: true, source: true } });
    const previousEvidence = Array.isArray(existingEntity?.evidence) ? existingEntity.evidence : [];
    const promotedEvidence = [...previousEvidence, ...merged.evidence].slice(-30);
    const promoted = await runWithActiveTenantLease(prisma, context.selectedTenant.id, (tx) => tx.schoolEntity.upsert({
      where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: input.name } },
      create: { tenantId: context.selectedTenant.id, type: input.type, name: input.name, aliases: [], confidence: merged.confidence, sensitivity: "normal", source: "ai_extract", evidence: promotedEvidence },
      update: { evidence: promotedEvidence, confidence: Math.max(existingEntity?.confidence ?? 0, merged.confidence), ...(existingEntity?.source === "admin" ? {} : { source: "ai_extract" }) },
    }));
    if (!promoted.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    await runWithActiveTenantLease(prisma, context.selectedTenant.id, (tx) => tx.schoolEntity.deleteMany({ where: { tenantId: context.selectedTenant.id, type: input.type, name: candidateName } }));
    await writeAuditLog({ tenantId: context.selectedTenant.id, actorId: context.user.id, action: "tenant.ai_review.entity.promote", targetType: "school_entity", targetId: promoted.value.id, detail: { type: input.type, sensitivity: inferredSensitivity, evidenceCount: merged.evidence.length } });
    return { entity: promoted.value, evidenceCount: merged.evidence.length, promoted: true };
  });

  app.post("/api/admin/ai-review/entities", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const input = entitySchema.parse(request.body);
    const existing = await prisma.schoolEntity.findUnique({ where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: input.name } }, select: { evidence: true, confidence: true, source: true } });
    const pendingCandidate = await prisma.schoolEntity.findUnique({ where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: `candidate:${input.name}` } }, select: { evidence: true, confidence: true } });
    const candidateEvidence = Array.isArray(pendingCandidate?.evidence) ? pendingCandidate.evidence : [];
    const saved = await runWithActiveTenantLease(prisma, context.selectedTenant.id, (tx) => tx.schoolEntity.upsert({
      where: { tenantId_type_name: { tenantId: context.selectedTenant.id, type: input.type, name: input.name } },
      create: { tenantId: context.selectedTenant.id, ...input, source: "admin", evidence: candidateEvidence },
      update: { ...input, aliases: [...new Set([...input.aliases, ...candidateEvidence.map((item) => item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : "").filter(Boolean)])].slice(0, 20), evidence: [...(Array.isArray(existing?.evidence) ? existing.evidence : []), ...candidateEvidence].slice(-30), confidence: Math.max(input.confidence, existing?.confidence ?? 0, pendingCandidate?.confidence ?? 0), source: "admin" },
    }));
    if (!saved.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    await runWithActiveTenantLease(prisma, context.selectedTenant.id, (tx) => tx.schoolEntity.deleteMany({ where: { tenantId: context.selectedTenant.id, type: input.type, name: `candidate:${input.name}` } }));
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
    await refreshTenantSchoolModel(tenantId);
    const snapshot = await prisma.schoolModelSnapshot.findFirst({ where: { tenantId, status: "active" }, orderBy: { version: "desc" } });
    if (!snapshot) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    await writeAuditLog({ tenantId, actorId: context.user.id, action: "tenant.ai_review.snapshot.refresh", targetType: "school_model_snapshot", targetId: snapshot.id, detail: { version: snapshot.version } });
    return { snapshot };
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
