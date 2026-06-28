import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireReadyTenant } from "../lib/auth";
import { listTenantPostTags } from "../lib/post-tags";
import { maintainTenantPostTags } from "../runtime/post-tagging";

const listTagsQuerySchema = z.object({
  includeArchived: z.coerce.boolean().default(false),
});

const maintainTagsBodySchema = z.object({
  lookbackDays: z.coerce.number().int().min(7).max(90).default(14),
}).default({});

export function registerPostTagRoutes(app: FastifyInstance) {
  app.get("/api/post-tags", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = listTagsQuerySchema.parse(request.query);
    const includeArchived = query.includeArchived && context.selectedMembership.role === "admin";
    return {
      tags: await listTenantPostTags(context.selectedTenant.id, { includeArchived }),
    };
  });

  app.post("/api/post-tags/maintain", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "admin");
    const body = maintainTagsBodySchema.parse(request.body ?? {});
    const result = await maintainTenantPostTags({
      tenantId: context.selectedTenant.id,
      lookbackDays: body.lookbackDays,
      logger: request.log,
    });
    return {
      ok: true,
      result,
    };
  });
}
