import type { FastifyInstance } from "fastify";
import { tenantSummarySchema } from "@campux/domain";
import { prisma } from "../lib/prisma";
import { toTenantSummary } from "../lib/serializers";
import { findTenantByRequestHost } from "../lib/tenant-host";

export function registerTenantRoutes(app: FastifyInstance) {
  app.get("/api/tenants", async (request) => {
    const hostTenant = await findTenantByRequestHost(request);
    if (hostTenant) {
      return {
        tenants: [tenantSummarySchema.parse(toTenantSummary(hostTenant))],
      };
    }

    const tenants = await prisma.tenant.findMany({
      where: {
        status: "active",
      },
      include: {
        metadata: {
          where: {
            key: "logo_url",
          },
        },
        aiSettings: {
          select: {
            enabled: true,
          },
        },
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
