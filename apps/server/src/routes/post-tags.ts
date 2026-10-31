import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isPrismaKnownRequestError, supportsAdvisoryLock } from "@campux/db";
import { requireReadyTenant, requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import {
  listTenantPostTags,
  maxTagsPerPost,
  normalizeTagName,
  readPostAssignedTags,
  serializePostTag,
  tagColorForName,
  upsertTenantTagByName,
} from "../lib/post-tags";
import { backfillPostsForTag, maintainTenantPostTags } from "../runtime/post-tagging";

/** 单稿标签数达到上限时抛出，使整个打标事务回滚（避免残留新建的标签）。 */
class TagLimitError extends Error {
  constructor() {
    super("tag limit reached");
    this.name = "TagLimitError";
  }
}

const listTagsQuerySchema = z.object({
  includeArchived: z.coerce.boolean().default(false),
});

const maintainTagsBodySchema = z.object({
  lookbackDays: z.coerce.number().int().min(7).max(90).default(14),
}).default({});

const assignTagBodySchema = z.object({
  postId: z.string().min(1),
  tagName: z.string().min(1).max(32),
});

const unassignTagBodySchema = z.object({
  postId: z.string().min(1),
  tagId: z.string().min(1),
});

const createTagBodySchema = z.object({
  tagName: z.string().min(1).max(32),
  description: z.string().max(100).optional(),
});

const backfillTagParamsSchema = z.object({
  id: z.string().min(1),
});

const backfillTagBodySchema = z.object({
  lookbackDays: z.coerce.number().int().min(7).max(90).optional(),
}).default({});

export function registerPostTagRoutes(app: FastifyInstance) {
  app.get("/api/post-tags", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = listTagsQuerySchema.parse(request.query);
    const includeArchived = query.includeArchived && context.selectedMembership.role === "admin";
    return {
      tags: await listTenantPostTags(context.selectedTenant.id, { includeArchived }),
    };
  });

  app.post("/api/post-tags/maintain", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = maintainTagsBodySchema.parse(request.body ?? {});
    // 整理含 LLM 请求与自动重试，耗时可达数分钟、会超过网关超时导致 "Failed to fetch"：
    // 改为后台执行并立即返回；失败由维护任务自身的自动重试兜底。
    void maintainTenantPostTags({
      tenantId: context.selectedTenant.id,
      lookbackDays: body.lookbackDays,
      logger: app.log,
    }).catch((error) => {
      app.log.warn({ error, tenantId: context.selectedTenant.id }, "post tag maintenance: background run failed");
    });
    return { ok: true, started: true };
  });

  // 手动打标：标签不存在则创建（source=manual），已归档则重新启用。
  app.post("/api/post-tags/assign", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = assignTagBodySchema.parse(request.body);
    const tagName = normalizeTagName(body.tagName);
    if (!tagName) {
      return reply.code(400).send({ message: "标签名不能为空" });
    }
    const post = await prisma.post.findFirst({
      where: { id: body.postId, tenantId: context.selectedTenant.id },
      select: { id: true },
    });
    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    const attemptAssign = () => prisma.$transaction(async (tx) => {
      // PG 下锁定稿件行串行化并发打标，避免并发把单稿标签数顶破上限；SQLite 单写者天然串行。
      if (supportsAdvisoryLock) {
        await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${post.id} AND "tenantId" = ${context.selectedTenant.id} FOR UPDATE`;
      }
      const tag = await upsertTenantTagByName(tx, { tenantId: context.selectedTenant.id, name: tagName });
      const assignments = await tx.postTagAssignment.findMany({
        where: { postId: post.id },
        select: { tagId: true },
      });
      if (!assignments.some((assignment) => assignment.tagId === tag.id) && assignments.length >= maxTagsPerPost) {
        throw new TagLimitError();
      }
      await tx.postTagAssignment.upsert({
        where: { postId_tagId: { postId: post.id, tagId: tag.id } },
        create: {
          tenantId: context.selectedTenant.id,
          postId: post.id,
          tagId: tag.id,
          source: "manual",
          confidence: null,
        },
        update: { source: "manual", confidence: null },
      });
      await tx.postTag.update({ where: { id: tag.id }, data: { lastUsedAt: new Date() } });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.tag.assign",
        targetType: "post",
        targetId: post.id,
        detail: { tagName: tag.name, source: "manual" },
      }, tx);
    });
    try {
      await attemptAssign();
    } catch (error) {
      // 并发创建同名标签的竞态：P2002 表示标签此刻已存在——这不是失败，重读并重试一次打标。
      if (!(isPrismaKnownRequestError(error) && error.code === "P2002")) {
        if (error instanceof TagLimitError) {
          return reply.code(409).send({ message: `每条稿件最多 ${maxTagsPerPost} 个标签` });
        }
        throw error;
      }
      try {
        await attemptAssign();
      } catch (retryError) {
        if (retryError instanceof TagLimitError) {
          return reply.code(409).send({ message: `每条稿件最多 ${maxTagsPerPost} 个标签` });
        }
        // 二次竞态极端少见：仍按已存在处理。
        if (isPrismaKnownRequestError(retryError) && retryError.code === "P2002") {
          return reply.code(409).send({ message: `标签「${tagName}」已存在` });
        }
        throw retryError;
      }
    }
    return { tags: await readPostAssignedTags(context.selectedTenant.id, post.id) };
  });

  // 手动新建标签（source=manual）：创建后可配合回溯打标把窗口内存量稿件归类进来，
  // 新稿件由 autoTagPost 即时纳入候选。POST /api/post-tags 已被话题功能的用户建标签占用。
  app.post("/api/post-tags/create", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = createTagBodySchema.parse(request.body);
    const tagName = normalizeTagName(body.tagName);
    if (!tagName) {
      return reply.code(400).send({ message: "标签名不能为空" });
    }
    const existing = await prisma.postTag.findUnique({
      where: { tenantId_name: { tenantId: context.selectedTenant.id, name: tagName } },
    });
    if (existing) {
      // 归档状态的标签直接恢复使用：让「新建同名标签」成为重新启用的入口。
      // 管理员手动重建视为人工标签（source=manual），不再被 AI 归档；恢复与审计同事务。
      if (existing.status !== "active") {
        const revived = await prisma.$transaction(async (tx) => {
          const updated = await tx.postTag.update({
            where: { id: existing.id },
            data: {
              status: "active",
              lastUsedAt: new Date(),
              source: "manual",
              ...(body.description?.trim() ? { description: body.description.trim() } : {}),
            },
          });
          await writeAuditLog({
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            action: "post.tag.create",
            targetType: "post_tag",
            targetId: updated.id,
            detail: { tagName, reactivated: true },
          }, tx);
          return updated;
        });
        return { tag: serializePostTag(revived) };
      }
      return reply.code(409).send({ message: `标签「${tagName}」已存在` });
    }
    let tag;
    try {
      // 标签插入与审计日志同事务：避免审计写入失败时出现无审计记录的标签。
      tag = await prisma.$transaction(async (tx) => {
        const created = await tx.postTag.create({
          data: {
            tenantId: context.selectedTenant.id,
            name: tagName,
            description: body.description?.trim() || null,
            color: tagColorForName(tagName),
            source: "manual",
            lastUsedAt: new Date(),
          },
        });
        await writeAuditLog({
          tenantId: context.selectedTenant.id,
          actorId: context.user.id,
          action: "post.tag.create",
          targetType: "post_tag",
          targetId: created.id,
          detail: { tagName, description: created.description },
        }, tx);
        return created;
      });
    } catch (error) {
      // 并发创建同名标签的竞态：唯一约束冲突按 409 返回而不是 500。
      if (isPrismaKnownRequestError(error) && error.code === "P2002") {
        return reply.code(409).send({ message: `标签「${tagName}」已存在` });
      }
      throw error;
    }
    return { tag: serializePostTag(tag) };
  });

  // 对指定标签做 AI 回溯打标：窗口内的存量稿件由 LLM 判断归属并 assign。
  app.post("/api/post-tags/:id/backfill", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = backfillTagParamsSchema.parse(request.params);
    const body = backfillTagBodySchema.parse(request.body ?? {});
    const tag = await prisma.postTag.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id, status: "active" },
      select: { id: true, name: true },
    });
    if (!tag) {
      return reply.code(404).send({ message: "标签不存在或已归档" });
    }
    const result = await backfillPostsForTag({
      tenantId: context.selectedTenant.id,
      tagId: tag.id,
      lookbackDays: body.lookbackDays,
      logger: request.log,
    });
    return { ok: true, result };
  });

  // 手动删除标签：PostTagAssignment 随级联删除（从所有稿件上移除该标签）。
  app.delete("/api/post-tags/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const params = backfillTagParamsSchema.parse(request.params);
    const tag = await prisma.postTag.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id },
      select: { id: true, name: true, _count: { select: { assignments: true } } },
    });
    if (!tag) {
      return reply.code(404).send({ message: "标签不存在" });
    }
    await prisma.$transaction(async (tx) => {
      await tx.postTag.delete({ where: { id: tag.id } });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.tag.delete",
        targetType: "post_tag",
        targetId: tag.id,
        detail: { tagName: tag.name, removedAssignments: tag._count.assignments },
      }, tx);
    });
    return { ok: true };
  });

  // 移除打标：不区分来源，管理员可以移除 AI 打的标签。
  app.post("/api/post-tags/unassign", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = unassignTagBodySchema.parse(request.body);
    const post = await prisma.post.findFirst({
      where: { id: body.postId, tenantId: context.selectedTenant.id },
      select: { id: true },
    });
    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    await prisma.$transaction(async (tx) => {
      await tx.postTagAssignment.deleteMany({
        where: { postId: post.id, tagId: body.tagId, tenantId: context.selectedTenant.id },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "post.tag.unassign",
        targetType: "post",
        targetId: post.id,
        detail: { tagId: body.tagId },
      }, tx);
    });
    return { tags: await readPostAssignedTags(context.selectedTenant.id, post.id) };
  });
}
