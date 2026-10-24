import type { FastifyBaseLogger } from "fastify";
import type { EventBus } from "@campux/plugin";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";
import { tenantRuntimeRelationFilter } from "../lib/tenant-runtime";
import { readTenantAiSettings } from "./ai-settings";
import { getAutoModerationGate } from "./auto-moderation";
import { readTenantOperateMode, readTenantPublishMode } from "../lib/tenant-metadata";
import { addApprovedPostToBatch } from "./publish-batching";
import { enqueuePublishFanout } from "./publishing";
import type { RuntimeQueue } from "./queue";
const POLL_INTERVAL_MS = 5_000;
const PUBLISH_RECOVERY_INTERVAL_MS = 30_000;
const GLOBAL_KILL_SWITCH_KEY = "ai_moderation_kill_switch";

type DueDecision = {
  id: string;
  tenantId: string;
  postId: string;
  post: { displayId: number };
  action: string | null;
  autoDecisionExecutingAt: Date | null;
  autoDecisionExecuteAfter: Date | null;
  createdAt: Date;
};

/** Starts a durable poller; pending decisions remain in the database across restarts. */
export function startAutoModerationScheduler(logger: FastifyBaseLogger, options: { queue?: RuntimeQueue; pluginEvents?: EventBus; oneBot?: { notifyReviewResult(postId: string, status: "approved" | "rejected", comment?: string | null): Promise<void> } } = {}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let lastPublishRecoveryAt = 0;
  let publishRecoveryRunning = false;
  const localClaims = new Set<string>();

  const poll = async () => {
    if (stopped || running) return;
    running = true;
    try {
      if (options.queue && Date.now() - lastPublishRecoveryAt >= PUBLISH_RECOVERY_INTERVAL_MS && !publishRecoveryRunning) {
        publishRecoveryRunning = true;
        lastPublishRecoveryAt = Date.now();
        try {
          await recoverApprovedPosts(logger, options, () => !stopped);
        } finally {
          publishRecoveryRunning = false;
        }
      }
      const due = await prisma.postAiAnalysis.findMany({
        where: {
          mode: "auto",
          autoDecision: { in: ["approve", "reject"] },
          autoDecisionExecuteAfter: { lte: new Date() },
          OR: [
            { autoDecisionLeaseAt: null },
            { autoDecisionLeaseAt: { lt: new Date(Date.now() - 60_000) } },
          ],
          autoDecisionCancelledAt: null,
          autoDecisionAt: null,
        },
        orderBy: [{ autoDecisionExecuteAfter: "asc" }, { createdAt: "asc" }],
        take: 100,
        select: { id: true, tenantId: true, postId: true, post: { select: { displayId: true } }, autoDecision: true, autoDecisionExecutingAt: true, autoDecisionExecuteAfter: true, createdAt: true },
      });
      for (const item of due) {
        if (stopped) break;
        if (localClaims.has(item.id)) continue;
        localClaims.add(item.id);
        try { await executeDueDecision({ ...item, action: item.autoDecision, autoDecisionExecutingAt: item.autoDecisionExecutingAt }, logger, options); }
        finally { localClaims.delete(item.id); }
      }
    } catch (error) {
      logger.error({ error }, "Auto-moderation scheduler poll failed");
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }
  };

  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function recoverApprovedPosts(logger: FastifyBaseLogger, options: { queue?: RuntimeQueue }, shouldContinue: () => boolean = () => true): Promise<void> {
  if (!options.queue || !shouldContinue()) return;
  try {
    const candidates = await prisma.post.findMany({
      where: {
        status: "approved",
        aiAnalyses: { some: { mode: "auto", autoDecision: "approve", autoDecisionAt: { not: null } } },
        publishAttempts: { none: {} },
        batchItem: { is: null },
        tenant: tenantRuntimeRelationFilter,
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
      select: { id: true, tenantId: true },
    });
    for (const post of candidates) {
      if (!shouldContinue()) break;
      try {
        const operateMode = await readTenantOperateMode(prisma, post.tenantId);
        if (operateMode === "manual") continue;
        const publishMode = await readTenantPublishMode(prisma, post.tenantId);
        if (publishMode.mode === "accumulate") await addApprovedPostToBatch(options.queue, post.tenantId, post.id, null, logger);
        else await enqueuePublishFanout(options.queue, post.tenantId, post.id, null);
      } catch (error) {
        logger.warn({ error, tenantId: post.tenantId, postId: post.id }, "Auto-approved post publish enqueue recovery failed; will retry");
      }
    }
  } catch (error) {
    logger.error({ error }, "Approved-post publish recovery failed");
  }
}

async function executeDueDecision(item: DueDecision & { action: string | null }, logger: FastifyBaseLogger, options: { queue?: RuntimeQueue; oneBot?: { notifyReviewResult(postId: string, status: "approved" | "rejected", comment?: string | null): Promise<void> } }): Promise<void> {
  if (item.action !== "approve" && item.action !== "reject") return;
  try {
    const outcome = await runWithActiveTenantLease(prisma, item.tenantId, async (tx) => {
      const settings = await readTenantAiSettings(item.tenantId, tx);
      const post = await tx.post.findFirst({ where: { id: item.postId, tenantId: item.tenantId, status: "pending_approval" }, select: { id: true, text: true, pendingTags: true, displayId: true } });
      const global = await tx.systemSetting.findUnique({ where: { key: GLOBAL_KILL_SWITCH_KEY }, select: { value: true } });
      const policy = settings.rules.autoModeration;
      const now = new Date();
      const staleBefore = new Date(now.getTime() - 60_000);
      const claimed = await tx.postAiAnalysis.updateMany({ where: { id: item.id, tenantId: item.tenantId, postId: item.postId, mode: "auto", status: "completed", autoDecision: item.action, autoDecisionExecuteAfter: { lte: now }, autoDecisionAt: null, autoDecisionCancelledAt: null, OR: [{ autoDecisionLeaseAt: null }, { autoDecisionLeaseAt: { lt: staleBefore } }] }, data: { autoDecisionLeaseAt: now, autoDecisionExecutingAt: now } });
      if (claimed.count !== 1) return false;
      const cancelDecision = async (reason: string) => {
        await tx.postAiAnalysis.updateMany({ where: { id: item.id, tenantId: item.tenantId, postId: item.postId, autoDecisionLeaseAt: now, autoDecisionExecutingAt: now, autoDecisionCancelledAt: null, autoDecisionAt: null }, data: { autoDecisionCancelledAt: now, autoDecisionLeaseAt: null, autoDecisionExecutingAt: null, autoDecisionReason: reason } });
        return false;
      };
      if (!post || settings.rules.aiReviewMode !== "auto" || policy?.enabled !== true || policy.globalKillSwitch === true || global?.value === "true" || (item.action === "approve" ? policy.autoApproveEnabled !== true : policy.autoRejectEnabled !== true)) {
        return cancelDecision("自动审核紧急停止或策略已关闭，已取消待执行决定");
      }
      // Re-assess every staged decision against the current policy, current post
      // body and current feedback calibration. Stale
      // decisions never execute merely because their delay has elapsed.
      const feedback = await tx.aiFeedback.findMany({ where: { tenantId: item.tenantId, humanAction: { not: "" }, aiAction: { not: "" } }, select: { humanAction: true, aiAction: true, matched: true, categories: true } });
      const labeled = feedback.filter((entry) => entry.categories.length > 0);
      const rates: Record<string, { total: number; matched: number }> = {};
      for (const entry of labeled) for (const category of new Set(entry.categories)) {
        const rate = rates[category] ??= { total: 0, matched: 0 };
        rate.total += 1;
        if (entry.matched && entry.humanAction === entry.aiAction) rate.matched += 1;
      }
      const fresh = await tx.postAiAnalysis.findUnique({ where: { id: item.id }, select: { riskLevel: true, confidence: true, categories: true, sensitiveFindings: true, suggestedAction: true } });
      if (!fresh || !fresh.riskLevel || !fresh.suggestedAction || typeof fresh.confidence !== "number") {
        return cancelDecision("原始 AI 评估不完整，待执行决定已取消");
      }
      const currentAssessment = { riskLevel: fresh.riskLevel, confidence: fresh.confidence, categories: fresh.categories, sensitiveFindings: fresh.sensitiveFindings, suggestedAction: fresh.suggestedAction, reasons: [], maskedText: null, rewrittenText: null, rejectionReason: null } as const;
      const currentPolicy = { enabled: policy.enabled, globalKillSwitch: policy.globalKillSwitch === true || global?.value === "true", autoApproveEnabled: policy.autoApproveEnabled === true, autoRejectEnabled: policy.autoRejectEnabled === true, allowedAutoApproveCategories: policy.allowedAutoApproveCategories, blockedPatterns: policy.blockedPatterns, minimumConfidence: policy.minimumConfidence, minimumValidatedSamples: policy.minimumValidatedSamples, delaySeconds: policy.delaySeconds };
      const reevaluated = getAutoModerationGate(currentPolicy, currentAssessment as never, { validatedSamples: feedback.length, matchedCategoryRates: rates }, post.text);
      if (reevaluated.action !== item.action) {
        return cancelDecision("执行前当前策略或人工校准已变化，原待执行决定已取消");
      }
      const postUpdate = await tx.post.updateMany({ where: { id: item.postId, tenantId: item.tenantId, status: "pending_approval" }, data: item.action === "approve" ? { status: "approved" } : { status: "rejected" } });
      if (postUpdate.count !== 1) return cancelDecision("稿件已不再待审核，自动决定已取消");
      const finalized = await tx.postAiAnalysis.updateMany({ where: { id: item.id, tenantId: item.tenantId, postId: item.postId, autoDecision: item.action, autoDecisionLeaseAt: now, autoDecisionExecutingAt: now, autoDecisionCancelledAt: null, autoDecisionAt: null }, data: { autoDecisionAt: now, autoDecisionLeaseAt: null, autoDecisionExecutingAt: null } });
      if (finalized.count !== 1) throw new Error("Auto-moderation lease ownership lost before finalization");
      await tx.postLog.create({ data: { tenantId: item.tenantId, postId: item.postId, actorId: null, oldStatus: "pending_approval", newStatus: item.action === "approve" ? "approved" : "rejected", comment: "延迟自动审核决策已执行" } });
      if (item.action === "approve" && post?.pendingTags) {
        for (const name of post.pendingTags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 5)) {
          const tag = await tx.postTag.upsert({ where: { tenantId_name: { tenantId: item.tenantId, name } }, create: { tenantId: item.tenantId, name, color: "#F64E54", source: "user", status: "active", lastUsedAt: now }, update: { status: "active", lastUsedAt: now } });
          await tx.postTagAssignment.upsert({ where: { postId_tagId: { postId: item.postId, tagId: tag.id } }, create: { tenantId: item.tenantId, postId: item.postId, tagId: tag.id, source: "user" }, update: {} });
        }
        await tx.post.update({ where: { id: item.postId }, data: { pendingTags: null } });
      }
      await writeAuditLog({ tenantId: item.tenantId, action: item.action === "approve" ? "post.approve" : "post.reject", targetType: "post", targetId: item.postId, detail: item.action === "approve" ? { displayId: item.post.displayId } : { displayId: item.post.displayId, comment: "自动审核拒绝" } }, tx);
      return true;
    });
    if (!outcome.active || outcome.value === false) return;
    if (item.action === "approve" && options.queue) {
      const operateMode = await readTenantOperateMode(prisma, item.tenantId);
      if (operateMode !== "manual") {
        const publishMode = await readTenantPublishMode(prisma, item.tenantId);
        if (publishMode.mode === "accumulate") await addApprovedPostToBatch(options.queue, item.tenantId, item.postId, null, logger);
        else await enqueuePublishFanout(options.queue, item.tenantId, item.postId, null);
      }
    }
    if (options.pluginEvents) {
      if (item.action === "approve") options.pluginEvents.emit({ type: "review:approved", tenantId: item.tenantId, postId: item.postId, reviewerId: "system" });
      else options.pluginEvents.emit({ type: "review:rejected", tenantId: item.tenantId, postId: item.postId, reviewerId: "system", reason: "自动审核拒绝" });
    }
    if (item.action === "reject" && options.oneBot) {
      await options.oneBot.notifyReviewResult(item.postId, "rejected", "自动审核拒绝").catch((error) => {
        logger.warn({ error, tenantId: item.tenantId, postId: item.postId }, "Delayed auto-rejection committed; review-result notification failed");
      });
    }
    logger.info({ tenantId: item.tenantId, postId: item.postId, action: item.action }, "Delayed auto-moderation decision executed");
  } catch (error) {
    logger.error({ error, tenantId: item.tenantId, postId: item.postId, action: item.action }, "Delayed auto-moderation post-commit work failed; committed decisions are recovered by the approved-post publish sweeper");
  }
}
