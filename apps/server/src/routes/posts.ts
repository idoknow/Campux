import { Buffer } from "node:buffer";
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CampuxConfig } from "@campux/config";
import { createS3Client } from "@campux/integrations";
import { requireTenantContext } from "../lib/auth";
import { prisma } from "../lib/prisma";

const uploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  base64: z.string().min(1),
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

function toPostListItem(post: {
  id: string;
  displayId: number;
  text: string;
  images: unknown;
  anonymous: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: post.id,
    displayId: post.displayId,
    title: post.text.length > 28 ? `${post.text.slice(0, 28)}...` : post.text,
    text: post.text,
    images: post.images,
    anonymous: post.anonymous,
    status: post.status,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

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

export function registerPostRoutes(app: FastifyInstance, config: CampuxConfig) {
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
      url: `${config.s3.publicBaseUrl}/${key}`,
      fileName: body.fileName,
    };
  });

  app.post("/api/posts", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const body = createPostSchema.parse(request.body);

    const post = await prisma.$transaction(async (tx) => {
      const aggregate = await tx.post.aggregate({
        where: {
          tenantId: context.selectedTenant.id,
        },
        _max: {
          displayId: true,
        },
      });

      return tx.post.create({
        data: {
          tenantId: context.selectedTenant.id,
          authorId: context.user.id,
          displayId: (aggregate._max.displayId ?? 0) + 1,
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

    return {
      post: toPostListItem(post),
    };
  });

  app.get("/api/posts/mine", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const posts = await prisma.post.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        authorId: context.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    return {
      posts: posts.map(toPostListItem),
    };
  });

  app.post("/api/posts/:id/cancel", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
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
            comment: "投稿者取消",
          },
        },
      },
    });

    return {
      post: toPostListItem(updated),
    };
  });
}
