import { Buffer } from "node:buffer";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CampuxConfig } from "@campux/config";
import { requireTenantContext, requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { compressImageBuffer, uploadAttachmentBytes } from "../lib/attachments";
import { prisma } from "../lib/prisma";
import { assertTenantLogoUpload, tenantLogoMaxBytes } from "../lib/tenant-logo-upload";
import {
  maxPendingPostLimit,
  normalizePendingPostLimit,
  pendingPostLimitMetadataKey,
  imageCompressionEnabledKey,
  imageCompressionQualityKey,
  imageCompressionMaxDimensionKey,
  botStylishMessagesEnabledKey,
  normalizeBotStylishMessagesEnabled,
  readTenantImageCompression,
} from "../lib/tenant-metadata";

const publicMetadataKeys = [
  "brand",
  "banner",
  "logo_url",
  "post_rules",
  "services",
  pendingPostLimitMetadataKey,
  imageCompressionEnabledKey,
  imageCompressionQualityKey,
  imageCompressionMaxDimensionKey,
  botStylishMessagesEnabledKey,
] as const;

const patchMetadataSchema = z.object({
  tenantName: z.string().min(1).max(80).optional(),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/).optional(),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brand: z.string().min(1).optional(),
  banner: z.string().optional(),
  logoUrl: z.string().trim().max(1000).refine((value) => value === "" || /^https?:\/\//i.test(value) || value.startsWith("/"), "Logo URL 必须是 http(s) 或站内路径").optional(),
  postRules: z.array(z.string().min(1)).optional(),
  pendingPostLimit: z.number().int().min(0).max(maxPendingPostLimit).optional(),
  services: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      url: z.string().url().optional(),
    }),
  ).optional(),
  imageCompressionEnabled: z.boolean().optional(),
  imageCompressionQuality: z.number().int().min(40).max(95).optional(),
  imageCompressionMaxDimension: z.number().int().min(512).max(4096).optional(),
  botStylishMessagesEnabled: z.boolean().optional(),
});

function normalizeMetadata(entries: Array<{ key: string; value: unknown }>) {
  const record = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));

  const normalizeEnabled = (v: unknown) => typeof v === "boolean" ? v : typeof v === "string" ? v === "true" || v === "1" : true;
  const normalizeQuality = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 80;
    return Number.isFinite(n) ? Math.max(40, Math.min(95, Math.floor(n))) : 80;
  };
  const normalizeMaxDimension = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 2048;
    return Number.isFinite(n) ? Math.max(512, Math.min(4096, Math.floor(n))) : 2048;
  };

  return {
    brand: typeof record.brand === "string" ? record.brand : "校园墙",
    banner: typeof record.banner === "string" ? record.banner : "",
    logoUrl: typeof record.logo_url === "string" ? record.logo_url : "",
    postRules: Array.isArray(record.post_rules) ? record.post_rules.filter((rule) => typeof rule === "string") : [],
    pendingPostLimit: normalizePendingPostLimit(record[pendingPostLimitMetadataKey]),
    services: Array.isArray(record.services) ? record.services : [],
    imageCompression: {
      enabled: normalizeEnabled(record[imageCompressionEnabledKey]),
      quality: normalizeQuality(record[imageCompressionQualityKey]),
      maxDimension: normalizeMaxDimension(record[imageCompressionMaxDimensionKey]),
    },
    botStylishMessagesEnabled: normalizeBotStylishMessagesEnabled(record[botStylishMessagesEnabledKey]),
  };
}

async function readLogoPartCapped(sourceStream: NodeJS.ReadableStream): Promise<Buffer> {
  let transferredBytes = 0;
  const chunks: Buffer[] = [];
  const cap = tenantLogoMaxBytes();

  const limitedStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferredBytes += chunk.length;
      if (transferredBytes > cap) {
        callback(new Error("tenant logo size limit exceeded"));
        return;
      }
      chunks.push(chunk);
      callback();
    },
  });

  try {
    await pipeline(sourceStream, limitedStream);
    return Buffer.concat(chunks);
  } catch (error) {
    if (!limitedStream.destroyed) {
      limitedStream.destroy();
    }
    if (error instanceof Error && error.message.includes("tenant logo size limit exceeded")) {
      throw {
        status: 413,
        message: "Logo 图片不能超过 5MB",
      };
    }
    throw error;
  }
}

async function readPublicMetadata(tenantId: string) {
  const entries = await prisma.tenantMetadata.findMany({
    where: {
      tenantId,
      key: {
        in: [...publicMetadataKeys],
      },
    },
  });

  return normalizeMetadata(entries);
}

export function registerMetadataRoutes(app: FastifyInstance, config: CampuxConfig) {
  app.get("/api/context", async (request, reply) => {
    const context = await requireTenantContext(request, reply);

    return {
      tenant: {
        id: context.selectedTenant.id,
        slug: context.selectedTenant.slug,
        name: context.selectedTenant.name,
        themeColor: context.selectedTenant.themeColor,
      },
      membership: {
        id: context.selectedMembership.id,
        role: context.selectedMembership.role,
      },
      user: {
        id: context.user.id,
        qqUin: context.user.qqUin.toString(),
        displayName: context.user.displayName,
        systemRole: context.user.systemRole,
      },
    };
  });

  app.get("/api/tenant/metadata", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    return readPublicMetadata(context.selectedTenant.id);
  });

  app.post("/api/admin/tenant/logo", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    let uploadedLogoUrl = "";

    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          continue;
        }

        if (part.fieldname !== "logo") {
          part.file.destroy();
          continue;
        }

        const mime = part.mimetype || "application/octet-stream";
        const mimeValidation = assertTenantLogoUpload({ contentType: mime, size: 0 });
        if (!mimeValidation.ok) {
          part.file.destroy();
          return reply.code(mimeValidation.status).send({ message: mimeValidation.message });
        }

        const rawBuffer = await readLogoPartCapped(part.file);
        const sizeValidation = assertTenantLogoUpload({ contentType: mime, size: rawBuffer.length });
        if (!sizeValidation.ok) {
          return reply.code(sizeValidation.status).send({ message: sizeValidation.message });
        }

        const compression = await readTenantImageCompression(prisma, context.selectedTenant.id);
        const finalBuffer = await compressImageBuffer(rawBuffer, mime, compression);
        const attachment = await uploadAttachmentBytes({
          config,
          tenantId: context.selectedTenant.id,
          kind: "image",
          contentType: mime,
          fileName: part.filename || "tenant-logo.png",
          body: finalBuffer,
        });
        uploadedLogoUrl = attachment.url;
        break;
      }
    } catch (error) {
      if (typeof error === "object" && error !== null && "status" in error && "message" in error) {
        const errorObj = error as { status: number; message: string };
        return reply.code(errorObj.status).send({ message: errorObj.message });
      }
      throw error;
    }

    if (!uploadedLogoUrl) {
      return reply.code(400).send({ message: "请选择要上传的 Logo 图片" });
    }

    await prisma.tenantMetadata.upsert({
      where: {
        tenantId_key: {
          tenantId: context.selectedTenant.id,
          key: "logo_url",
        },
      },
      update: {
        value: uploadedLogoUrl,
      },
      create: {
        tenantId: context.selectedTenant.id,
        key: "logo_url",
        value: uploadedLogoUrl,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.logo.upload",
      targetType: "tenant",
      targetId: context.selectedTenant.id,
      detail: {
        logoUrl: uploadedLogoUrl,
      },
    });

    return {
      logoUrl: uploadedLogoUrl,
      metadata: await readPublicMetadata(context.selectedTenant.id),
    };
  });

  app.patch("/api/admin/tenant/metadata", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = patchMetadataSchema.parse(request.body);

    if (body.tenantName !== undefined || body.slug !== undefined || body.themeColor !== undefined) {
      const tenantUpdate: {
        name?: string;
        slug?: string;
        themeColor?: string;
      } = {};
      if (body.tenantName !== undefined) tenantUpdate.name = body.tenantName;
      if (body.slug !== undefined) tenantUpdate.slug = body.slug;
      if (body.themeColor !== undefined) tenantUpdate.themeColor = body.themeColor;

      await prisma.tenant.update({
        where: {
          id: context.selectedTenant.id,
        },
        data: tenantUpdate,
      });
    }

    const updates: Array<{ key: string; value: string | number | string[] | boolean | Array<{ title: string; description?: string | undefined; url?: string | undefined }> }> = [];
    if (body.brand !== undefined) {
      updates.push({ key: "brand", value: body.brand });
    }
    if (body.banner !== undefined) {
      updates.push({ key: "banner", value: body.banner });
    }
    if (body.logoUrl !== undefined) {
      updates.push({ key: "logo_url", value: body.logoUrl });
    }
    if (body.postRules !== undefined) {
      updates.push({ key: "post_rules", value: body.postRules });
    }
    if (body.pendingPostLimit !== undefined) {
      updates.push({ key: pendingPostLimitMetadataKey, value: body.pendingPostLimit });
    }
    if (body.services !== undefined) {
      updates.push({ key: "services", value: body.services });
    }
    if (body.imageCompressionEnabled !== undefined) {
      updates.push({ key: imageCompressionEnabledKey, value: body.imageCompressionEnabled });
    }
    if (body.imageCompressionQuality !== undefined) {
      updates.push({ key: imageCompressionQualityKey, value: body.imageCompressionQuality });
    }
    if (body.imageCompressionMaxDimension !== undefined) {
      updates.push({ key: imageCompressionMaxDimensionKey, value: body.imageCompressionMaxDimension });
    }
    if (body.botStylishMessagesEnabled !== undefined) {
      updates.push({ key: botStylishMessagesEnabledKey, value: body.botStylishMessagesEnabled });
    }

    await prisma.$transaction(
      updates.map((entry) =>
        prisma.tenantMetadata.upsert({
          where: {
            tenantId_key: {
              tenantId: context.selectedTenant.id,
              key: entry.key,
            },
          },
          update: {
            value: entry.value,
          },
          create: {
            tenantId: context.selectedTenant.id,
            key: entry.key,
            value: entry.value,
          },
        }),
      ),
    );

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "tenant.metadata.update",
      targetType: "tenant",
      targetId: context.selectedTenant.id,
      detail: {
        fields: Object.keys(body),
      },
    });

    return readPublicMetadata(context.selectedTenant.id);
  });
}
