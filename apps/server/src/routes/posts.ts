import { Buffer } from "node:buffer";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CampuxConfig } from "@campux/config";
import { Prisma } from "@campux/db";
import { createS3Client } from "@campux/integrations";
import { renderPostCard } from "@campux/render";
import { hasTenantRole, requireTenantContext } from "../lib/auth";
import { toPostListItem } from "../lib/posts";
import { prisma } from "../lib/prisma";
import { readTenantPendingPostLimit } from "../lib/tenant-metadata";
import type { OneBotRuntime } from "../runtime/onebot";

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

const legacyUploadSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1).optional(),
  base64: z.string().min(1),
});

class PendingPostLimitError extends Error {
  constructor(
    readonly pendingCount: number,
    readonly limit: number,
  ) {
    super("pending post limit exceeded");
  }
}

function sanitizeUploadExtension(fileName: string | undefined): string {
  const raw = fileName?.split(".").pop();
  if (!raw) {
    return "bin";
  }
  return raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
  "image/svg+xml",
]);

function isAllowedImageType(contentType: string): boolean {
  return IMAGE_MIME_TYPES.has(contentType);
}

function headerIncludes(value: string | string[] | undefined, expected: string): boolean {
  return Array.isArray(value) ? value.some((item) => item.includes(expected)) : Boolean(value?.includes(expected));
}

function readLegacyUploadContentType(value: string, fallback: string | undefined): string {
  const match = /^data:([^;,]+)[;,]/.exec(value);
  return fallback || match?.[1] || "application/octet-stream";
}

function decodeLegacyBase64Upload(value: string): Buffer {
  const commaIndex = value.indexOf(",");
  const payload = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  return Buffer.from(payload, "base64");
}

function isUploadTooLargeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  return code === "FST_REQ_FILE_TOO_LARGE" || error.message.includes("size limit exceeded") || error.message.includes("File size limit exceeded");
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

async function uploadImageBytes({
  config,
  tenantId,
  fileName,
  contentType,
  body,
}: {
  config: CampuxConfig;
  tenantId: string;
  fileName: string;
  contentType: string;
  body: Buffer | Transform;
}) {
  const extension = sanitizeUploadExtension(fileName);
  const key = `tenants/${tenantId}/uploads/${crypto.randomUUID()}.${extension}`;
  const s3 = await ensureBucket(config);

  await new Upload({
    client: s3,
    params: {
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
  }).done();

  return {
    key,
    url: `/api/uploads/post-image?key=${encodeURIComponent(key)}`,
    fileName,
  };
}

function isTransactionSerializationFailure(value: unknown) {
  return value instanceof Prisma.PrismaClientKnownRequestError && value.code === "P2034";
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
    const requestContentType = request.headers["content-type"] ?? "";
    const maxUploadSize = 10 * 1024 * 1024;

    if (headerIncludes(requestContentType, "application/json")) {
      const body = legacyUploadSchema.parse(request.body);
      const contentType = readLegacyUploadContentType(body.base64, body.contentType);
      if (!isAllowedImageType(contentType)) {
        return reply.code(400).send({ message: "仅支持图片格式（jpg/png/gif/webp）" });
      }

      const bytes = decodeLegacyBase64Upload(body.base64);
      if (bytes.byteLength > maxUploadSize) {
        return reply.code(413).send({ message: "图片不能超过 10MB" });
      }

      return uploadImageBytes({
        config,
        tenantId: context.selectedTenant.id,
        fileName: body.fileName,
        contentType,
        body: bytes,
      });
    }

    let file;
    try {
      file = await request.file();
    } catch (error) {
      if (isUploadTooLargeError(error)) {
        return reply.code(413).send({ message: "图片不能超过 10MB" });
      }
      throw error;
    }
    if (!file) {
      return reply.code(400).send({ message: "请上传图片文件" });
    }

    const contentType = file.mimetype || "application/octet-stream";
    if (!isAllowedImageType(contentType)) {
      file.file.destroy();
      return reply.code(400).send({ message: "仅支持图片格式（jpg/png/gif/webp）" });
    }

    const sourceStream = file.file;
    let transferredBytes = 0;
    const limitedStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferredBytes += chunk.length;
        if (transferredBytes > maxUploadSize) {
          callback(new Error("size limit exceeded"));
          return;
        }
        callback(null, chunk);
      },
    });

    const uploadPromise = uploadImageBytes({
      config,
      tenantId: context.selectedTenant.id,
      fileName: file.filename ?? `image.${sanitizeUploadExtension(undefined)}`,
      contentType,
      body: limitedStream,
    });

    try {
      const [result] = await Promise.all([
        uploadPromise,
        pipeline(sourceStream, limitedStream),
      ]);
      return result;
    } catch (error: unknown) {
      if (!limitedStream.destroyed) {
        limitedStream.destroy();
      }
      if (!sourceStream.destroyed) {
        sourceStream.destroy();
      }
      if (isUploadTooLargeError(error)) {
        return reply.code(413).send({ message: "图片不能超过 10MB" });
      }
      return reply.code(500).send({ message: "图片上传失败，请重试" });
    }
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

    let post: Awaited<ReturnType<typeof prisma.post.create>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        post = await prisma.$transaction(
          async (tx) => {
            const pendingPostLimit = await readTenantPendingPostLimit(tx, context.selectedTenant.id);
            if (pendingPostLimit > 0) {
              const pendingCount = await tx.post.count({
                where: {
                  tenantId: context.selectedTenant.id,
                  authorId: context.user.id,
                  status: "pending_approval",
                },
              });
              if (pendingCount >= pendingPostLimit) {
                throw new PendingPostLimitError(pendingCount, pendingPostLimit);
              }
            }

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
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (caught) {
        if (caught instanceof PendingPostLimitError) {
          return reply.code(409).send({
            message: `你还有 ${caught.pendingCount} 条稿件待审核，当前校园墙最多同时保留 ${caught.limit} 条待审核稿件。`,
          });
        }
        if (isTransactionSerializationFailure(caught) && attempt < 2) {
          continue;
        }
        throw caught;
      }
    }

    if (!post) {
      return reply.code(503).send({ message: "投稿人数较多，请稍后再试" });
    }

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
      displayHost: post.tenant.host,
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
