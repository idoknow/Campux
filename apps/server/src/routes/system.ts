import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSystemOperator } from "../lib/auth";
import { prisma } from "../lib/prisma";

const tenantStatusSchema = z.enum(["active", "paused", "archived"]);

const tenantPatchSchema = z.object({
  status: tenantStatusSchema,
});

function toSystemTenant(
  tenant: Awaited<ReturnType<typeof prisma.tenant.findMany>>[number] & {
    _count: {
      botAccounts: number;
      posts: number;
      memberships: number;
    };
  },
) {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    botAccountCount: tenant._count.botAccounts,
    postCount: tenant._count.posts,
    memberCount: tenant._count.memberships,
  };
}

async function listSystemTenants() {
  const tenants = await prisma.tenant.findMany({
    include: {
      _count: {
        select: {
          botAccounts: true,
          posts: true,
          memberships: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  return tenants.map(toSystemTenant);
}

export function registerSystemRoutes(app: FastifyInstance) {
  app.get("/api/system/tenants", async (request, reply) => {
    await requireSystemOperator(request, reply);

    return {
      tenants: await listSystemTenants(),
    };
  });

  app.patch("/api/system/tenants/:tenantId", async (request, reply) => {
    await requireSystemOperator(request, reply);
    const params = z.object({ tenantId: z.string().min(1) }).parse(request.params);
    const body = tenantPatchSchema.parse(request.body);

    await prisma.tenant.update({
      where: { id: params.tenantId },
      data: {
        status: body.status,
      },
    });

    return {
      tenants: await listSystemTenants(),
    };
  });
}
