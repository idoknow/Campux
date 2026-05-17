import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantContext, requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import { maxPendingPostLimit, normalizePendingPostLimit, pendingPostLimitMetadataKey } from "../lib/tenant-metadata";

const publicMetadataKeys = ["brand", "banner", "logo_url", "post_rules", "services", pendingPostLimitMetadataKey] as const;

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
});

function normalizeMetadata(entries: Array<{ key: string; value: unknown }>) {
  const record = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));

  return {
    brand: typeof record.brand === "string" ? record.brand : "校园墙",
    banner: typeof record.banner === "string" ? record.banner : "",
    logoUrl: typeof record.logo_url === "string" ? record.logo_url : "",
    postRules: Array.isArray(record.post_rules) ? record.post_rules.filter((rule) => typeof rule === "string") : [],
    pendingPostLimit: normalizePendingPostLimit(record[pendingPostLimitMetadataKey]),
    services: Array.isArray(record.services) ? record.services : [],
  };
}

export function registerMetadataRoutes(app: FastifyInstance) {
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
    const entries = await prisma.tenantMetadata.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        key: {
          in: [...publicMetadataKeys],
        },
      },
    });

    return normalizeMetadata(entries);
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

    const updates: Array<{ key: string; value: string | number | string[] | Array<{ title: string; description?: string | undefined; url?: string | undefined }> }> = [];
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

    const entries = await prisma.tenantMetadata.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        key: {
          in: [...publicMetadataKeys],
        },
      },
    });

    return normalizeMetadata(entries);
  });
}
