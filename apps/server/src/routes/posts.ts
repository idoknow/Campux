import { Buffer } from "node:buffer";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CampuxConfig } from "@campux/config";
import { createS3Client } from "@campux/integrations";
import { renderPostCard } from "@campux/render";
import { hasTenantRole, requireTenantContext } from "../lib/auth";
import { toPostListItem } from "../lib/posts";
import { prisma } from "../lib/prisma";
import type { OneBotRuntime } from "../runtime/onebot";

const uploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  base64: z.string().min(1),
});

const fileQuerySchema = z.object({
  key: z.string().min(1),
});

const postParamsSchema = z.object({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const createPostSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  anonymous: z.boolean().default(false),
  images: z.array(
    z.object({
      key: z.string().min(1),
      url: z.string().min(1),
      fileName: z.string().min(1),
    }),
  ).max(9).default([]),
});

function decodeBase64(base64: string) {
  const commaIndex = base64.indexOf(",");
  const payload = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
  return Buffer.from(payload, "base64");
}

async function ensureBucket(config: CampuxConfig) {
  const s3 = createS3Client(config);
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
  }

  return s3;
}

export function registerPostRoutes(app: FastifyInstance, config: CampuxConfig, oneBot?: OneBotRuntime) {
  app.get("/api/uploads/post-image", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const query = fileQuerySchema.parse(request.query);
    const allowedPrefixes = [
      `tenants/${context.selectedTenant.id}/uploads/`,
      `tenants/${context.selectedTenant.id}/legacy/`,
    ];
    if (!allowedPrefixes.some((prefix) => query.key.startsWith(prefix))) {
      return reply.code(403).send({ message: "没有访问该图片的权限" });
    }

    const s3 = await ensureBucket(config);
    const object = await s3.send(
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: query.key,
      }),
    );

    if (object.ContentType) {
      reply.header("Content-Type", object.ContentType);
    }
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(object.Body);
  });

  app.post("/api/uploads/post-images", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const body = uploadSchema.parse(request.body);
    const bytes = decodeBase64(body.base64);
    if (bytes.byteLength > 8 * 1024 * 1024) {
      return reply.code(413).send({ message: "图片不能超过 8MB" });
    }

    const extension = body.fileName.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
    const key = `tenants/${context.selectedTenant.id}/uploads/${crypto.randomUUID()}.${extension}`;
    const s3 = await ensureBucket(config);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: bytes,
        ContentType: body.contentType,
      }),
    );

    return {
      key,
      url: `/api/uploads/post-image?key=${encodeURIComponent(key)}`,
      fileName: body.fileName,
    };
  });

  app.post("/api/posts", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const body = createPostSchema.parse(request.body);
    const activeBan = await prisma.banRecord.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        userId: context.user.id,
        endsAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        endsAt: "desc",
      },
    });
    if (activeBan) {
      return reply.code(403).send({ message: `账号已被封禁：${activeBan.comment}` });
    }

    const post = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: {
          id: context.selectedTenant.id,
        },
        data: {
          nextPostDisplayId: {
            increment: 1,
          },
        },
        select: {
          nextPostDisplayId: true,
        },
      });
      const displayId = tenant.nextPostDisplayId - 1;

      return tx.post.create({
        data: {
          tenantId: context.selectedTenant.id,
          authorId: context.user.id,
          displayId,
          text: body.text,
          anonymous: body.anonymous,
          images: body.images,
          status: "pending_approval",
          logs: {
            create: {
              tenantId: context.selectedTenant.id,
              actorId: context.user.id,
              newStatus: "pending_approval",
              comment: "投稿创建",
            },
          },
        },
      });
    });

    oneBot?.notifyNewPost(post.id).catch((error) => {
      app.log.warn({ error, postId: post.id }, "failed to notify review group");
    });

    return {
      post: toPostListItem(post),
    };
  });

  app.get("/api/posts/mine", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const query = listQuerySchema.parse(request.query);
    const where = {
      tenantId: context.selectedTenant.id,
      authorId: context.user.id,
    };
    const [total, posts] = await Promise.all([
      prisma.post.count({ where }),
      prisma.post.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      posts: posts.map(toPostListItem),
      pagination: toPagination(query.page, query.limit, total),
    };
  });

  function toPagination(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  app.get("/api/posts/:id/render-preview", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        id: params.id,
      },
      include: {
        author: true,
        tenant: true,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.authorId !== context.user.id && !hasTenantRole(context.selectedMembership.role, "reviewer")) {
      return reply.code(403).send({ message: "没有权限预览该稿件" });
    }

    const previewBot = await prisma.botAccount.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        enabled: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const bytes = await renderPostCard({
      tenantName: post.tenant.name,
      authorName: post.author.displayName ?? post.author.qqUin.toString(),
      authorQq: post.author.qqUin.toString(),
      cornerQq: previewBot?.qqUin.toString(),
      text: post.text,
      createdAt: post.createdAt,
      anonymous: post.anonymous,
    });

    reply.header("Cache-Control", "private, max-age=60");
    reply.type("image/jpeg");
    return reply.send(Buffer.from(bytes));
  });

  app.post("/api/posts/:id/cancel", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const params = postParamsSchema.parse(request.params);
    const post = await prisma.post.findFirst({
      where: {
        id: params.id,
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
      },
    });

    if (!post) {
      return reply.code(404).send({ message: "稿件不存在" });
    }
    if (post.status !== "pending_approval") {
      return reply.code(409).send({ message: "只有待审核稿件可以取消" });
    }

    const updated = await prisma.post.update({
      where: {
        id: post.id,
      },
      data: {
        status: "cancelled",
        logs: {
          create: {
            tenantId: context.selectedTenant.id,
            actorId: context.user.id,
            oldStatus: post.status,
            newStatus: "cancelled",
            comment: "用户取消",
          },
        },
      },
    });
    oneBot?.notifyPostCancelled(updated.id).catch((error) => {
      app.log.warn({ error, postId: updated.id }, "failed to notify post cancellation");
    });

    return {
      post: toPostListItem(updated),
    };
  });
}
