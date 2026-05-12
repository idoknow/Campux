import type { FastifyInstance } from "fastify";
import { tenantSummarySchema } from "@campux/domain";
import { prisma } from "../lib/prisma";
import { toTenantSummary } from "../lib/serializers";

export function registerTenantRoutes(app: FastifyInstance) {
  app.get("/api/tenants", async () => {
    const tenants = await prisma.tenant.findMany({
      where: {
        status: "active",
      },
      include: {
        _count: {
          select: {
            botAccounts: true,
            posts: {
              where: {
                status: "pending_approval",
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return {
      tenants: tenants.map((tenant) => tenantSummarySchema.parse(toTenantSummary(tenant))),
    };
  });
}
