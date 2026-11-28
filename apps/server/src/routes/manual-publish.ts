import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import {
  readTenantManualPublishSettings,
  readTenantOperateMode,
  readTenantPublishMode,
  type ManualPublishTemplate,
} from "../lib/tenant-metadata";
import { readTenantIngressAvailabilityFromDb } from "../lib/tenant-ingress";
import { enqueuePublishFanout } from "../runtime/publishing";
import { addApprovedPostToBatch } from "../runtime/publish-batching";
import type { RuntimeQueue } from "../runtime/queue";

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const pendingSortValues = ["oldest", "newest", "images"] as const;
type PendingSort = (typeof pendingSortValues)[number];

const pendingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  // 关键词：匹配正文、稿件编号或作者 QQ/昵称。
  q: z.string().trim().max(80).optional(),
  anonymous: z.enum(["all", "anonymous", "named"]).default("all"),
  withImages: z.enum(["all", "images", "text"]).default("all"),
  sort: z.enum(pendingSortValues).default("oldest"),
});

const batchConfirmSchema = z.object({
  // 为空表示确认「当前筛选条件下」的全部待发布稿件。
  ids: z.array(z.string().min(1)).max(200).optional(),
  // 无 Bot 模式下管理员把稿件发到 QQ 空间后，可以顺手记下说说链接，便于事后追溯。
  publishUrl: z.string().trim().max(1000).optional(),
  // 与列表页相同的筛选条件：一键确认必须只作用于屏幕上这批稿件。
  q: z.string().trim().max(80).optional(),
  anonymous: z.enum(["all", "anonymous", "named"]).default("all"),
  withImages: z.enum(["all", "images", "text"]).default("all"),
});

/**
 * 把列表页的筛选条件转成 Prisma where。
 * 列表与批量确认共用，避免「界面上筛了、后台却按全量确认」这种不一致。
 */
function pendingFilterWhere(tenantId: string, filter: {
  q?: string | undefined;
  anonymous: "all" | "anonymous" | "named";
  withImages: "all" | "images" | "text";
}) {
  const keyword = filter.q?.trim();
  const base: Record<string, unknown> = pendingPublishWhere(tenantId);
  if (filter.anonymous === "anonymous") base.anonymous = true;
  else if (filter.anonymous === "named") base.anonymous = false;
  if (keyword) {
    base.OR = [
      { text: { contains: keyword } },
      ...(/^\d+$/.test(keyword) && Number(keyword) <= 2_147_483_647 ? [{ displayId: Number(keyword) }] : []),
      ...(/^\d{5,}$/.test(keyword) ? [{ author: { qqUin: BigInt(keyword) } }] : []),
      { author: { displayName: { contains: keyword } } },
    ];
  }
  // 配图筛选无法用 Prisma 表达（attachments 是 JSON），由调用方在取数后处理。
  return base;
}

const revertBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

/**
 * 仍占着「自动发布流程」的尝试状态。
 *
 * 待发布的判定不能用「没有任何尝试」：bot → manual 切换时被停下的稿件会留下
 * `skipped` 尝试（见 halt-in-flight），终态失败留下 `failed`。这些稿件已经不在
 * 自动队列里了，必须能进待发布，否则既发不出去也删不掉。
 */
const blockingAttemptStatuses = ["queued", "running", "waiting_cookies", "succeeded"] as const;

/** 待发布队列的过滤条件：已被自动发布接手（在途或已成功）的稿件不重复列出。 */
function pendingPublishWhere(tenantId: string) {
  return {
    tenantId,
    status: "approved" as const,
    publishAttempts: { none: { status: { in: [...blockingAttemptStatuses] } } },
    batchItem: { is: null },
  };
}

function pendingPublishOrderBy(sort: PendingSort) {
  switch (sort) {
    case "newest":
      return [{ createdAt: "desc" as const }, { displayId: "desc" as const }];
    case "images":
      // 图片数量不做 DB 排序（attachments 是 JSON），前端按 attachmentCount 展示，
      // 这里用「稿件编号倒序」保证稳定分页，再由前端优先提示多图稿件。
      return [{ createdAt: "desc" as const }, { id: "asc" as const }];
    case "oldest":
    default:
      return [{ createdAt: "asc" as const }, { id: "asc" as const }];
  }
}

/**
 * 无 Bot 模式（operate_mode=manual）的发布任务：
 * 审核通过的稿件不进入自动发布队列，而是留在 status=approved，
 * 由管理员在「稿件 · 待发布」里逐条渲染、保存图片、手动发到 QQ 空间，
 * 再回到页面点「确认已发布」把状态推进到 published，归入已发布分组。
 */
export function registerManualPublishRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.get("/api/admin/pending-publish", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const query = pendingListQuerySchema.parse(request.query);
    const where = pendingFilterWhere(context.selectedTenant.id, query);

    const selectFields = {
      id: true,
      displayId: true,
      text: true,
      anonymous: true,
      attachments: true,
      createdAt: true,
      author: { select: { id: true, qqUin: true, displayName: true } },
    } as const;

    const toItem = (post: {
      id: string;
      displayId: number;
      text: string;
      anonymous: boolean;
      attachments: unknown;
      createdAt: Date;
      author: { id: string; qqUin: bigint; displayName: string | null };
    }) => ({
      id: post.id,
      displayId: post.displayId,
      text: post.text,
      anonymous: post.anonymous,
      attachmentCount: Array.isArray(post.attachments) ? post.attachments.length : 0,
      attachments: Array.isArray(post.attachments) ? post.attachments : [],
      createdAt: post.createdAt.toISOString(),
      author: {
        id: post.author.id,
        qqUin: post.author.qqUin.toString(),
        displayName: post.author.displayName,
      },
    });

    const withImagesAll = query.withImages === "all";
    if (withImagesAll) {
      const [total, posts] = await Promise.all([
        prisma.post.count({ where }),
        prisma.post.findMany({
          where,
          select: selectFields,
          orderBy: pendingPublishOrderBy(query.sort),
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
      ]);
      return {
        posts: posts.map(toItem),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pageCount: Math.max(1, Math.ceil(total / query.limit)),
        },
      };
    }

    // 配图筛选无法在 Prisma 里表达（attachments 是 JSON 列）：先取出全量命中的 id 与附件数，
    // 在内存里过滤后再分页，否则会出现「第一页空、目标在第 N 页」以及 total 与实际不符。
    const candidates = await prisma.post.findMany({
      where,
      select: { id: true, attachments: true },
      orderBy: pendingPublishOrderBy(query.sort),
    });
    const matchedIds = candidates
      .filter((post) => {
        const count = Array.isArray(post.attachments) ? post.attachments.length : 0;
        return query.withImages === "images" ? count > 0 : count === 0;
      })
      .map((post) => post.id);

    const total = matchedIds.length;
    const pageIds = matchedIds.slice((query.page - 1) * query.limit, (query.page - 1) * query.limit + query.limit);
    const posts = pageIds.length === 0
      ? []
      : await prisma.post.findMany({ where: { id: { in: pageIds } }, select: selectFields });
    // findMany 不保证顺序，按上面算好的页内顺序重排。
    const byId = new Map(posts.map((post) => [post.id, post]));

    return {
      posts: pageIds.map((id) => byId.get(id)).filter(Boolean).map((post) => toItem(post!)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  });

  // 待发布工作台的物料：文案模板、墙号 QQ（渲染图角落用）、是否已开启进站通道。
  // 单独一个接口，避免把设置塞进列表响应里导致每次翻页都重复拉取。
  app.get("/api/admin/pending-publish/context", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    const settings = await readTenantManualPublishSettings(prisma, context.selectedTenant.id);
    const [residual, inFlight, ingress] = await Promise.all([
      prisma.post.count({ where: pendingPublishWhere(context.selectedTenant.id) }),
      // 仍在自动发布队列里的稿件数：bot → manual 后前端据此显示「停止在途自动发布」。
      prisma.post.count({
        where: {
          tenantId: context.selectedTenant.id,
          status: { in: ["publishing", "partially_failed"] },
        },
      }),
      readTenantIngressAvailabilityFromDb(prisma, context.selectedTenant.id),
    ]);
    return {
      operateMode,
      residual,
      inFlight,
      template: settings.template,
      wallQq: settings.wallQq,
      ingress,
    };
  });

  app.post("/api/admin/pending-publish/:id/confirm", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = postParamsSchema.parse(request.params);
    const body = batchConfirmSchema.parse(request.body ?? {});
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
      },
      select: {
        id: true,
        displayId: true,
        status: true,
        batchItem: { select: { id: true } },
        publishAttempts: {
          where: { status: { in: [...blockingAttemptStatuses] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "approved") {
      return reply.code(409).send({ message: "只有待发布稿件可以确认发布" });
    }
    // 自动发布模式下的稿件不能绕过发布队列：只有真正滞留（未入批、没有在途/成功尝试）的才允许确认。
    // 被 halt-in-flight 停下的稿件只有 skipped 尝试，不算在流程中。
    if (operateMode !== "manual" && (post.batchItem !== null || post.publishAttempts.length > 0)) {
      return reply.code(409).send({ message: "该稿件已在自动发布流程中" });
    }

    const { url: publishUrl, normalized: publishUrlIgnored } = normalizePublishUrl(body.publishUrl);

    await prisma.$transaction(async (transaction) => {
      await transaction.post.update({
        where: { id: post.id },
        data: {
          status: "published",
          publishSummary: "管理员手动发布",
          manualPublishedAt: new Date(),
          manualPublishUrl: publishUrl,
          logs: {
            create: {
              tenantId: context.selectedTenant.id,
              actorId: context.user.id,
              oldStatus: "approved",
              newStatus: "published",
              comment: publishUrl
                ? `管理员确认已手动发布：${publishUrl}`
                : "管理员确认已手动发布",
            },
          },
        },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.manual_publish",
        targetType: "post",
        targetId: post.id,
        detail: { displayId: post.displayId, publishUrl: publishUrl ?? null, publishUrlIgnored },
      }, transaction);
    });

    return { ok: true, manualPublishUrl: publishUrl, publishUrlIgnored };
  });

  // 多选 / 一键确认：把选中的（或「当前筛选条件下」的全部）待发布稿件批量推进到 published。
  // 逐条独立处理：单条不在 approved / 已被自动队列接手 / 被并发推进时只记录到 failures，
  // 不影响其余稿件，前端据此列出失败的稿件号与原因。
  app.post("/api/admin/pending-publish/confirm", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = batchConfirmSchema.parse(request.body ?? {});
    // 界面上的筛选必须带过来：否则「一键确认全部」会把不在屏幕上的稿件也改掉。
    const filteredWhere = pendingFilterWhere(context.selectedTenant.id, body);
    const { url: publishUrl, normalized: publishUrlIgnored } = normalizePublishUrl(body.publishUrl);

    // 先按筛选（含配图）算出真正命中集合，再与显式 ids 取交集。
    const candidates = await prisma.post.findMany({
      where: filteredWhere,
      select: { id: true, displayId: true, attachments: true },
      orderBy: { createdAt: "asc" },
    });
    const matchedCandidates = body.withImages === "all"
      ? candidates
      : candidates.filter((post) => {
        const count = Array.isArray(post.attachments) ? post.attachments.length : 0;
        return body.withImages === "images" ? count > 0 : count === 0;
      });
    const allowedIds = new Set(matchedCandidates.map((post) => post.id));
    const targets = body.ids && body.ids.length > 0
      ? matchedCandidates.filter((post) => body.ids!.includes(post.id))
      : matchedCandidates;

    // 显式点名但已不在待发布队列的稿件也要告诉调用方，而不是静默丢弃。
    const foundIds = new Set(targets.map((target) => target.id));
    const failures: Array<{ id: string; displayId: number | null; reason: string; code: "NOT_PENDING" | "CONFLICT" }> = [];
    if (body.ids && body.ids.length > 0) {
      const missing = await prisma.post.findMany({
        where: { tenantId: context.selectedTenant.id, id: { in: body.ids.filter((id) => !foundIds.has(id)) } },
        select: { id: true, displayId: true },
      });
      const missingById = new Map(missing.map((post) => [post.id, post.displayId]));
      for (const id of body.ids) {
        if (!foundIds.has(id)) {
          failures.push({
            id,
            displayId: missingById.get(id) ?? null,
            reason: missingById.has(id) ? "稿件已不在待发布状态（可能已被发布或进入自动队列）" : "稿件不存在或不属于当前校园墙",
            code: "NOT_PENDING",
          });
        }
      }
    }

    const confirmedIds: string[] = [];
    const confirmedDisplayIds: number[] = [];
    const confirmedAt = new Date();
    for (const target of targets) {
      // 每条一个事务：单条失败不回滚已成功的其余稿件。
      try {
        const done = await prisma.$transaction(async (transaction) => {
          // updateMany 带状态条件：并发下被别处推进/撤回的稿件不会误写。
          const updated = await transaction.post.updateMany({
            where: { id: target.id, status: "approved" },
            data: {
              status: "published",
              publishSummary: "管理员手动发布",
              manualPublishedAt: confirmedAt,
              manualPublishUrl: publishUrl,
            },
          });
          if (updated.count === 0) {
            return false;
          }
          await transaction.postLog.create({
            data: {
              postId: target.id,
              tenantId: context.selectedTenant.id,
              actorId: context.user.id,
              oldStatus: "approved",
              newStatus: "published",
              comment: publishUrl
                ? `管理员确认已手动发布（批量）：${publishUrl}`
                : "管理员确认已手动发布（批量）",
            },
          });
          return true;
        });
        if (done) {
          confirmedIds.push(target.id);
          confirmedDisplayIds.push(target.displayId);
        } else {
          failures.push({
            id: target.id,
            displayId: target.displayId,
            reason: "状态已变化，不再是可以确认的待发布稿",
            code: "CONFLICT",
          });
        }
      } catch (error) {
        request.log.error({ err: error, postId: target.id }, "batch manual publish failed");
        failures.push({
          id: target.id,
          displayId: target.displayId,
          reason: error instanceof Error ? error.message : "写入失败",
          code: "CONFLICT",
        });
      }
    }

    if (confirmedIds.length > 0) {
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.manual_publish",
        targetType: "post",
        targetId: confirmedIds[0] ?? null,
        detail: {
          count: confirmedIds.length,
          bulk: true,
          postIds: confirmedIds.slice(0, 50),
          failed: failures.length,
          publishUrl: publishUrl ?? null,
          publishUrlIgnored,
        },
      });
    }

    return {
      ok: true,
      confirmed: confirmedIds.length,
      confirmedDisplayIds,
      failed: failures.length,
      failures,
      publishUrlIgnored,
    };
  });

  // 误点「确认已发布」的兜底：把已确认的稿件退回待发布。
  // 只回退「管理员手动确认」的稿件（manualPublishedAt 非空且无发布尝试），
  // 自动发布链路产生的 published 稿件不受影响。
  app.post("/api/admin/pending-publish/revert", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = revertBodySchema.parse(request.body ?? {});
    const posts = await prisma.post.findMany({
      where: { tenantId: context.selectedTenant.id, id: { in: body.ids } },
      select: {
        id: true,
        displayId: true,
        status: true,
        manualPublishedAt: true,
        publishAttempts: { select: { id: true, status: true } },
      },
    });
    const byId = new Map(posts.map((post) => [post.id, post]));

    const revertedDisplayIds: number[] = [];
    const failures: Array<{ id: string; displayId: number | null; reason: string }> = [];
    for (const id of body.ids) {
      const post = byId.get(id);
      if (!post) {
        failures.push({ id, displayId: null, reason: "稿件不存在或不属于当前校园墙" });
        continue;
      }
      // 资格只看「是不是管理员手动确认的」：被 halt 停下的稿件会留下 skipped/failed 终态尝试，
      // 它们并没有真正发出去，应该允许回退。真正自动发布成功的稿件没有 manualPublishedAt。
      const hasPublishedAttempt = post.publishAttempts.some((attempt) =>
        attempt.status === "succeeded" || attempt.status === "running");
      if (post.status !== "published" || post.manualPublishedAt === null || hasPublishedAttempt) {
        failures.push({ id, displayId: post.displayId, reason: "只有管理员手动确认发布的稿件可以退回待发布" });
        continue;
      }
      try {
        // 状态推进、日志、审计同事务：任何一步失败都回滚，稿件仍可重试。
        const done = await prisma.$transaction(async (transaction) => {
          const updated = await transaction.post.updateMany({
            where: { id, tenantId: context.selectedTenant.id, status: "published", manualPublishedAt: { not: null } },
            data: {
              status: "approved",
              manualPublishedAt: null,
              manualPublishUrl: null,
              publishSummary: null,
            },
          });
          if (updated.count === 0) {
            return false;
          }
          await transaction.postLog.create({
            data: {
              tenantId: context.selectedTenant.id,
              postId: id,
              actorId: context.user.id,
              oldStatus: "published",
              newStatus: "approved",
              comment: "管理员撤销「确认已发布」，稿件退回待发布",
            },
          });
          await writeAuditLog({
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            action: "post.manual_publish.revert",
            targetType: "post",
            targetId: id,
            detail: { displayId: post.displayId },
          }, transaction);
          return true;
        });
        if (!done) {
          failures.push({ id, displayId: post.displayId, reason: "状态已变化，请刷新后重试" });
          continue;
        }
        revertedDisplayIds.push(post.displayId);
      } catch (error) {
        request.log.error({ err: error, postId: id }, "manual publish revert failed");
        failures.push({ id, displayId: post.displayId, reason: error instanceof Error ? error.message : "写入失败" });
      }
    }

    return { ok: true, reverted: revertedDisplayIds.length, revertedDisplayIds, failed: failures.length, failures };
  });

  // manual → bot 切换后，审核通过但从未进入发布队列的稿件会滞留。
  // 这里给出滞留数量，并提供一键补入自动发布队列（按当前发布模式入批或入队）。
  app.get("/api/admin/pending-publish/residual", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    const total = await prisma.post.count({ where: pendingPublishWhere(context.selectedTenant.id) });
    // 已进入自动发布队列、仍在途（排队/发布中）的稿件数量：bot → manual 切换时提示用。
    const inFlight = await prisma.post.count({
      where: {
        tenantId: context.selectedTenant.id,
        status: { in: ["publishing", "partially_failed"] },
      },
    });
    return { operateMode, residual: total, inFlight };
  });

  app.post("/api/admin/pending-publish/requeue", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    if (operateMode === "manual") {
      return reply.code(409).send({ message: "当前为无 Bot 模式，滞留稿件应在待发布页手动发布" });
    }

    const publishMode = await readTenantPublishMode(prisma, context.selectedTenant.id);
    const targets = await prisma.post.findMany({
      where: pendingPublishWhere(context.selectedTenant.id),
      select: { id: true, displayId: true },
      orderBy: { createdAt: "asc" },
    });

    let enqueued = 0;
    for (const target of targets) {
      try {
        if (publishMode.mode === "accumulate") {
          await addApprovedPostToBatch(queue, context.selectedTenant.id, target.id, context.user.id, request.log);
        } else {
          await enqueuePublishFanout(queue, context.selectedTenant.id, target.id, context.user.id);
        }
        enqueued += 1;
      } catch (error) {
        // 单条失败（如租户被暂停）不应阻断其余滞留稿件，但留日志便于排查。
        request.log.error({ err: error, postId: target.id }, "residual requeue failed");
      }
    }

    if (enqueued > 0) {
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.manual_requeue",
        targetType: "post",
        targetId: targets[0]?.id ?? null,
        detail: { count: enqueued, publishMode: publishMode.mode },
      });
    }

    return { ok: true, enqueued, total: targets.length };
  });

  // bot → manual 切换时，已经在自动发布队列里的稿件仍会继续自动发出去。
  // 这里把它们停下来（取消未完成的发布尝试），交回待发布队列由管理员手动发布，
  // 避免运营者以为「切成无 Bot 就停了」而重复发一遍说说。
  app.post("/api/admin/pending-publish/halt-in-flight", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const operateMode = await readTenantOperateMode(prisma, context.selectedTenant.id);
    if (operateMode !== "manual") {
      return reply.code(409).send({ message: "只有无 Bot 模式才需要停止在途自动发布" });
    }

    const candidates = await prisma.post.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        status: { in: ["publishing", "partially_failed"] },
        OR: [
          { publishAttempts: { some: { status: { in: ["queued", "waiting_cookies", "failed"] } } } },
          { batchItem: { isNot: null } },
        ],
      },
      select: {
        id: true,
        displayId: true,
        status: true,
        batchItem: { select: { id: true, batchId: true } },
        publishAttempts: { select: { id: true, status: true } },
      },
    });

    const haltedDisplayIds: number[] = [];
    for (const post of candidates) {
      // 已经真正发出去的（succeeded/running）不能撤销，只能跳过剩下的排队任务。
      const cancellable = post.publishAttempts.filter((attempt) => ["queued", "waiting_cookies", "failed"].includes(attempt.status));
      const hasRunning = post.publishAttempts.some((attempt) => attempt.status === "running");
      if (hasRunning) {
        continue;
      }
      // 没有可取消尝试、也没有批次条目的稿件不需要处理（例如全被 skipped 的残留）。
      if (cancellable.length === 0 && !post.batchItem) {
        continue;
      }
      try {
        await prisma.$transaction(async (transaction) => {
          if (cancellable.length > 0) {
            await transaction.publishAttempt.updateMany({
              where: { id: { in: cancellable.map((attempt) => attempt.id) } },
              data: { status: "skipped", lastError: "切换到无 Bot 模式，管理员已停止在途自动发布", nextRunAt: null },
            });
          }
          // 退出批量收集：批次条目保留（批次状态由后续 fanout 逻辑处理），稿件本身回到待发布。
          if (post.batchItem) {
            await transaction.publishBatchItem.deleteMany({ where: { postId: post.id } });
          }
          await transaction.post.update({
            where: { id: post.id },
            data: {
              status: "approved",
              logs: {
                create: {
                  tenantId: context.selectedTenant.id,
                  actorId: context.user.id,
                  oldStatus: post.status,
                  newStatus: "approved",
                  comment: "切换到无 Bot 模式，已停止在途自动发布，退回待发布",
                },
              },
            },
          });
        });
        haltedDisplayIds.push(post.displayId);
      } catch (error) {
        request.log.error({ err: error, postId: post.id }, "halt in-flight publish failed");
      }
    }

    if (haltedDisplayIds.length > 0) {
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.manual_publish.halt_in_flight",
        targetType: "post",
        targetId: candidates[0]?.id ?? null,
        detail: { count: haltedDisplayIds.length, displayIds: haltedDisplayIds.slice(0, 50) },
      });
    }

    return { ok: true, halted: haltedDisplayIds.length, haltedDisplayIds, total: candidates.length };
  });

  // 手动发布文案：按稿件的匿名状态拼出可直接粘贴到 QQ 空间的说说文案。
  app.get("/api/admin/pending-publish/:id/caption", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id },
      select: {
        displayId: true,
        text: true,
        anonymous: true,
        author: { select: { qqUin: true } },
      },
    });
    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    const settings = await readTenantManualPublishSettings(prisma, context.selectedTenant.id);
    return { caption: renderManualPublishCaption(settings.template, {
      displayId: post.displayId,
      text: post.text,
      anonymous: post.anonymous,
      authorQq: post.author.qqUin.toString(),
    }) };
  });
}

/**
 * 只接受 http(s) 链接；空串/未填视为「没有记录」。
 * 返回 normalized 表示「格式不合法、已被忽略」，让调用方可以如实告诉运营者。
 */
function normalizePublishUrl(value: string | undefined): { url: string | null; normalized: boolean } {
  const raw = value?.trim();
  if (!raw) return { url: null, normalized: false };
  if (!/^https?:\/\//i.test(raw)) return { url: null, normalized: true };
  return { url: raw.slice(0, 1000), normalized: false };
}

/**
 * 手动发说说时的文案模板：
 * - 默认只带 `#稿件编号`；
 * - includeAuthorQq 时追加 `@作者QQ`（匿名稿件不会带）；
 * - customText 作为固定前缀、suffixText 作为固定后缀各出现一次。
 */
export function renderManualPublishCaption(
  template: ManualPublishTemplate,
  post: { displayId: number; text: string; anonymous: boolean; authorQq: string },
): string {
  const firstLine: string[] = [];
  if (template.customText.trim()) firstLine.push(template.customText.trim());
  if (template.includePostId) firstLine.push(`#${post.displayId}`);
  if (template.includeAuthorQq && !post.anonymous) firstLine.push(`@${post.authorQq}`);
  const lines = [firstLine.join(" ").trim()];
  if (template.suffixText.trim()) lines.push(template.suffixText.trim());
  return lines.filter(Boolean).join("\n") || `#${post.displayId}`;
}
