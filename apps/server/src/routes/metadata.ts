import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenantContext, requireTenantRole } from "../lib/auth";
import { prisma } from "../lib/prisma";

const publicMetadataKeys = ["brand", "banner", "post_rules", "services"] as const;

const patchMetadataSchema = z.object({
  brand: z.string().min(1).optional(),
  banner: z.string().optional(),
  postRules: z.array(z.string().min(1)).optional(),
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
    postRules: Array.isArray(record.post_rules) ? record.post_rules.filter((rule) => typeof rule === "string") : [],
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

    const updates: Array<{ key: string; value: string | string[] | Array<{ title: string; description?: string | undefined; url?: string | undefined }> }> = [];
    if (body.brand !== undefined) {
      updates.push({ key: "brand", value: body.brand });
    }
    if (body.banner !== undefined) {
      updates.push({ key: "banner", value: body.banner });
    }
    if (body.postRules !== undefined) {
      updates.push({ key: "post_rules", value: body.postRules });
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
