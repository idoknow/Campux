import type { FastifyInstance } from "fastify";
import type { PluginRegistry } from "@campux/plugin";
import { requireReadyTenant } from "../lib/auth";
import { z } from "zod";

const pluginStatusSchema = z.object({
  status: z.enum(["enabled", "disabled"]),
});

const eventLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/**
 * 插件管理路由。
 * 提供已注册插件的列表查询、启用/禁用和事件日志，供管理面板使用。
 */
export function registerPluginRoutes(app: FastifyInstance, pluginRegistry: PluginRegistry) {
  // 获取所有已注册插件的信息
  app.get("/api/admin/plugins", async (request, reply) => {
    await requireReadyTenant(request, reply, "admin");

    const statuses = pluginRegistry.listStatuses();
    const plugins = pluginRegistry.list().map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description ?? null,
      campuxVersion: plugin.campuxVersion ?? null,
      hasInit: !!plugin.hooks?.onInit,
      hasReady: !!plugin.hooks?.onReady,
      hasClose: !!plugin.hooks?.onClose,
      status: statuses.get(plugin.name) ?? "enabled",
    }));

    return { plugins };
  });

  // 设置插件启用/禁用状态
  app.patch("/api/admin/plugins/:name/status", async (request, reply) => {
    await requireReadyTenant(request, reply, "admin");
    const params = z.object({ name: z.string().min(1) }).parse(request.params);
    const body = pluginStatusSchema.parse(request.body);

    const plugin = pluginRegistry.get(params.name);
    if (!plugin) {
      return reply.code(404).send({ message: "插件不存在" });
    }

    pluginRegistry.setStatus(params.name, body.status);
    app.log.info(`[PluginRoutes] plugin "${params.name}" status set to "${body.status}" by admin`);

    return {
      ok: true,
      name: params.name,
      status: body.status,
    };
  });

  // 获取插件事件日志
  app.get("/api/admin/plugins/events", async (request, reply) => {
    await requireReadyTenant(request, reply, "admin");
    const query = eventLogQuerySchema.parse(request.query);

    const events = pluginRegistry.getEventBus().getRecentEvents(query.limit);

    return {
      events: events.map((entry) => ({
        timestamp: new Date(entry.timestamp).toISOString(),
        type: entry.event.type,
        ...Object.fromEntries(
          Object.entries(entry.event).filter(([key]) => key !== "type")
        ),
      })),
    };
  });

  // 获取插件权限声明
  app.get("/api/admin/plugins/permissions", async (request, reply) => {
    await requireReadyTenant(request, reply, "admin");

    const permissions = pluginRegistry.listPermissions();

    return {
      permissions: permissions.map((p) => ({
        name: p.name,
        required: p.permissions?.required ?? [],
        riskLevel: p.permissions?.riskLevel ?? "unknown",
        rationale: p.permissions?.rationale ?? null,
      })),
    };
  });

  // 获取插件审计日志
  app.get("/api/admin/plugins/audit", async (request, reply) => {
    await requireReadyTenant(request, reply, "admin");
    const query = auditLogQuerySchema.parse(request.query);

    const auditLog = pluginRegistry.getAuditLog(query.limit);

    return {
      auditLog: auditLog.map((entry) => ({
        id: `${entry.timestamp}-${entry.pluginName}`,
        timestamp: new Date(entry.timestamp).toISOString(),
        action: entry.action,
        pluginName: entry.pluginName,
        operator: entry.operator ?? null,
        detail: entry.detail ?? null,
        metadata: entry.metadata ?? null,
      })),
    };
  });
}