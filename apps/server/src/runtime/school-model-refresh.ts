import { prisma } from "../lib/prisma";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";
import { writeAuditLog } from "../lib/audit";
import { syncSchoolEntityAliases } from "@campux/db";

export type EntityEvidence = { analysisId: string; postId: string; type: string; name: string; sensitivity: "normal" | "sensitive" | "blocked"; confidence: number };
const ENTITY_TYPES = ["location", "class", "person_alias", "organization", "topic", "risky_phrase", "service"];

export function mergeEntityEvidence(existing: unknown, item: EntityEvidence): { evidence: EntityEvidence[]; confidence: number; promoted: boolean } {
  const prior = Array.isArray(existing) ? existing.filter((entry): entry is EntityEvidence => Boolean(entry) && typeof entry === "object" && typeof (entry as EntityEvidence).analysisId === "string") : [];
  const evidence = [...new Map([...prior, item].map((entry) => [entry.postId, entry] as const)).values()].slice(-30);
  return { evidence, confidence: Math.min(0.99, Math.max(item.confidence, ...evidence.map((entry) => entry.confidence))), promoted: item.sensitivity === "normal" && evidence.length >= 2 && new Set(evidence.map((entry) => entry.type)).size === 1 && new Set(evidence.map((entry) => entry.name.toLocaleLowerCase())).size === 1 };
}

export function inferCandidateSensitivity(finding: { type: string; excerpt: string; reason: string; sensitivity?: unknown }): EntityEvidence["sensitivity"] {
  if (finding.sensitivity === "blocked") return "blocked";
  const sensitiveType = /person|phone|email|account|address|student|name|privacy/i.test(finding.type);
  const sensitiveContent = /手机号|电话|邮箱|账号|身份证|住址|姓名|学号/.test(finding.excerpt);
  return sensitiveType || sensitiveContent ? "sensitive" : "normal";
}

export async function refreshTenantSchoolModel(tenantId: string): Promise<void> {
  const outcome = await runWithActiveTenantLease(prisma, tenantId, async (tx) => {
    const analyses = await tx.postAiAnalysis.findMany({ where: { tenantId, status: "completed" }, orderBy: { createdAt: "desc" }, take: 500, select: { id: true, postId: true, confidence: true, sensitiveFindings: true } });
    for (const analysis of analyses) {
      const findings = Array.isArray(analysis.sensitiveFindings) ? analysis.sensitiveFindings : [];
      for (const candidate of findings.slice(0, 20)) {
        if (!candidate || typeof candidate !== "object") continue;
        const value = candidate as Record<string, unknown>;
        const name = typeof value.excerpt === "string" ? value.excerpt.trim() : "";
        const type = typeof value.type === "string" && ENTITY_TYPES.includes(value.type) ? value.type : "person_alias";
        if (!name || name.length > 120) continue;
        const sensitivity = inferCandidateSensitivity({ type, excerpt: name, reason: typeof value.reason === "string" ? value.reason : "", sensitivity: value.sensitivity });
        const confidence = typeof value.confidence === "number" ? Math.max(0, Math.min(1, value.confidence)) : analysis.confidence ?? 0.5;
        const key = { tenantId, type, name };
        const candidateKey = { tenantId, type, name: `candidate:${name}` };
        const current = await tx.schoolEntity.findUnique({ where: { tenantId_type_name: candidateKey }, select: { evidence: true, confidence: true, sensitivity: true, source: true } });
        const merged = mergeEntityEvidence(current?.evidence, { analysisId: analysis.id, postId: analysis.postId, type, name, sensitivity, confidence });
        const savedCandidate = await tx.schoolEntity.upsert({ where: { tenantId_type_name: candidateKey }, create: { ...candidateKey, aliases: [], confidence: merged.confidence, sensitivity, source: "ai_candidate", evidence: merged.evidence }, update: { evidence: merged.evidence, confidence: Math.max(current?.confidence ?? 0, merged.confidence), sensitivity } });
        await syncSchoolEntityAliases(tx, tenantId, savedCandidate.id, [savedCandidate.name]);
        if (!merged.promoted || sensitivity !== "normal") continue;
        const approved = await tx.schoolEntity.findUnique({ where: { tenantId_type_name: key }, select: { id: true, aliases: true, evidence: true, confidence: true, source: true, sensitivity: true } });
        const approvedEvidence = Array.isArray(approved?.evidence) ? approved.evidence.filter((entry): entry is EntityEvidence => Boolean(entry) && typeof entry === "object" && typeof (entry as EntityEvidence).postId === "string") : [];
        const combined = mergeEntityEvidence(approvedEvidence, { analysisId: analysis.id, postId: analysis.postId, type, name, sensitivity, confidence });
        if (!combined.promoted) continue;
        const savedEntity = await tx.schoolEntity.upsert({ where: { tenantId_type_name: key }, create: { ...key, aliases: [], confidence: combined.confidence, sensitivity: "normal", source: "ai_extract", evidence: combined.evidence }, update: { evidence: combined.evidence, confidence: Math.max(approved?.confidence ?? 0, combined.confidence), ...(approved?.source === "admin" ? {} : { source: "ai_extract" }) } });
        await syncSchoolEntityAliases(tx, tenantId, savedEntity.id, [savedEntity.name, ...(Array.isArray(approved?.aliases) ? approved.aliases.filter((alias): alias is string => typeof alias === "string") : [])]);
        if (!approved) await writeAuditLog({ tenantId, action: "tenant.ai_review.entity.promote", targetType: "school_entity", targetId: candidateKey.name, detail: { type, name, evidenceCount: combined.evidence.length } }, tx);
      }
    }
    const [entities, feedback, settings] = await Promise.all([
      tx.schoolEntity.findMany({ where: { tenantId }, orderBy: [{ sensitivity: "desc" }, { updatedAt: "desc" }], take: 500, select: { type: true, name: true, aliases: true, sensitivity: true, confidence: true, source: true, evidence: true } }),
      tx.aiFeedback.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 500, select: { humanAction: true, matched: true, humanComment: true, aiAction: true } }),
      tx.tenantAiSettings.findUnique({ where: { tenantId }, select: { rules: true } }),
    ]);
    const latest = await tx.schoolModelSnapshot.findFirst({ where: { tenantId }, orderBy: { version: "desc" }, select: { version: true } });
    await tx.schoolModelSnapshot.updateMany({ where: { tenantId, status: "active" }, data: { status: "superseded" } });
    const snapshot = await tx.schoolModelSnapshot.create({ data: { tenantId, version: (latest?.version ?? 0) + 1, status: "active", summary: `校园审核上下文快照：收录 ${entities.length} 个实体和 ${feedback.length} 条人工反馈。`, entities: JSON.parse(JSON.stringify(entities)), riskMemory: JSON.parse(JSON.stringify(feedback)), rules: JSON.parse(JSON.stringify((settings?.rules as Record<string, unknown> | null)?.aiReviewRules ?? {})), metrics: { total: feedback.length, matched: feedback.filter((item) => item.matched).length, entityCount: entities.length, analysisCount: analyses.length } } });
    await writeAuditLog({ tenantId, action: "tenant.ai_review.snapshot.refresh", targetType: "school_model_snapshot", targetId: snapshot.id, detail: { version: snapshot.version, entityCount: entities.length, feedbackCount: feedback.length } }, tx);
  });
  if (!outcome.active) return;
}

export async function runSchoolModelRefreshTick(client: { tenant: { findMany(args: unknown): Promise<Array<{ id: string }>> } }, refresh: (tenantId: string) => Promise<void>, logger: { error(fields: unknown, message: string): void }, shouldContinue: () => boolean = () => true): Promise<void> {
  const tenants = await client.tenant.findMany({ where: { status: "active" }, select: { id: true }, take: 500 });
  for (const tenant of tenants) {
    if (!shouldContinue()) break;
    try { await refresh(tenant.id); }
    catch (error) { logger.error({ error, tenantId: tenant.id }, "School model refresh failed"); }
  }
}

export function registerSchoolModelRefreshScheduler(options: { logger: { error(fields: unknown, message: string): void } }) {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runSchoolModelRefreshTick(prisma, refreshTenantSchoolModel, options.logger, () => !stopped);
    } catch (error) { options.logger.error({ error }, "School model refresh scheduler failed"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 86_400_000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
