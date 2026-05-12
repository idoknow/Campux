import type { FastifyInstance } from "fastify";
import { tenantSummarySchema } from "@campux/domain";

const demoTenants = [
  {
    id: "tenant-canton",
    slug: "canton-wall",
    name: "广府校园墙",
    status: "active",
    themeColor: "#e0574f",
    botAccountCount: 3,
    pendingPostCount: 18,
  },
  {
    id: "tenant-riverside",
    slug: "riverside",
    name: "江岸同学墙",
    status: "active",
    themeColor: "#2f8f7b",
    botAccountCount: 2,
    pendingPostCount: 7,
  },
];

export function registerTenantRoutes(app: FastifyInstance) {
  app.get("/api/tenants", async () => ({
    tenants: demoTenants.map((tenant) => tenantSummarySchema.parse(tenant)),
  }));
}
