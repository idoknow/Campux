import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireReadyTenant, requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import {
  listTenantPostTags,
  maxTagsPerPost,
  normalizeTagName,
  readPostAssignedTags,
  upsertTenantTagByName,
} from "../lib/post-tags";
import { maintainTenantPostTags } from "../runtime/post-tagging";

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
    const result = await maintainTenantPostTags({
      tenantId: context.selectedTenant.id,
      lookbackDays: body.lookbackDays,
      logger: request.log,
    });
    return {
      ok: true,
      result,
    };
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
      select: {
        id: true,
        tagAssignments: { select: { tagId: true } },
      },
    });
    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    const assignedTagIds = new Set(post.tagAssignments.map((assignment) => assignment.tagId));
    const assigned = await prisma.$transaction(async (tx) => {
      const tag = await upsertTenantTagByName(tx, { tenantId: context.selectedTenant.id, name: tagName });
      if (!assignedTagIds.has(tag.id) && assignedTagIds.size >= maxTagsPerPost) {
        return null;
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
      return true;
    });
    if (!assigned) {
      return reply.code(409).send({ message: `每条稿件最多 ${maxTagsPerPost} 个标签` });
    }
    return { tags: await readPostAssignedTags(context.selectedTenant.id, post.id) };
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
    await prisma.postTagAssignment.deleteMany({
      where: { postId: post.id, tagId: body.tagId, tenantId: context.selectedTenant.id },
    });
    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "post.tag.unassign",
      targetType: "post",
      targetId: post.id,
      detail: { tagId: body.tagId },
    });
    return { tags: await readPostAssignedTags(context.selectedTenant.id, post.id) };
  });
}
