import type { FastifyInstance } from "fastify";
import type { PluginRegistry } from "@campux/plugin";
import { requireReadyTenant } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import {
  readTenantPluginConfig,
  tenantPluginConfigSchema,
  writeTenantPluginConfig,
  type TenantPluginConfig,
} from "../lib/tenant-plugin-config";
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

  // 读取插件配置（Markdown 渲染、多彩投稿、字体选择、匿名头像、Bot 多彩消息）
  app.get("/api/admin/plugins/settings", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "admin");
    const config = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    return { config };
  });

  // 保存插件配置
  app.patch("/api/admin/plugins/settings", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "admin");
    const parsed = tenantPluginConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: "插件配置格式不正确" });
    }
    const before = await readTenantPluginConfig(prisma, context.selectedTenant.id);
    const saved = await writeTenantPluginConfig(prisma, context.selectedTenant.id, parsed.data);

    // 按插件维度逐项写入审计日志，便于管理员追溯单个插件的配置变更
    const diffs: Array<{ pluginId: string; enabled: boolean; summary: string }> = [];
    const pluginSections: Array<[string, unknown, unknown]> = [
      ["markdownRender", before.markdownRender, saved.markdownRender],
      ["colorSelection", before.colorSelection, saved.colorSelection],
      ["fontSelection", before.fontSelection, saved.fontSelection],
      ["anonymousAvatar", before.anonymousAvatar, saved.anonymousAvatar],
      ["botStylishMessages", before.botStylishMessages, saved.botStylishMessages],
    ];
    for (const [pluginId, beforeValue, afterValue] of pluginSections) {
      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        const enabledAfter = Boolean((afterValue as { enabled?: boolean })?.enabled);
        const enabledBefore = Boolean((beforeValue as { enabled?: boolean })?.enabled);
        let summary = "配置已更新";
        if (enabledBefore !== enabledAfter) {
          summary = enabledAfter ? "已启用" : "已禁用";
        }
        diffs.push({ pluginId, enabled: enabledAfter, summary });
        await writeAuditLog({
          tenantId: context.selectedTenant.id,
          actorId: context.user.id,
          action: `tenant.plugin.${pluginId}.${enabledBefore !== enabledAfter ? (enabledAfter ? "enable" : "disable") : "config"}`,
          targetType: "tenant_plugin",
          targetId: pluginId,
          detail: {
            summary,
            enabledBefore,
            enabledAfter,
            before: beforeValue,
            after: afterValue,
          },
        });
      }
    }

    return { config: saved, changed: diffs };
  });

  // 读取插件配置审计日志（最近 N 条 tenant.plugin.* 记录）
  app.get("/api/admin/plugins/settings/logs", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "admin");
    const query = auditLogQuerySchema.parse(request.query);
    const rows = await prisma.auditLog.findMany({
      where: {
        tenantId: context.selectedTenant.id,
        targetType: "tenant_plugin",
      },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: query.limit,
    });
    type AuditRow = {
      id: string;
      createdAt: Date;
      action: string;
      targetId: string | null;
      detail: unknown;
      actor: { displayName: string | null; qqUin: bigint } | null;
    };
    return {
      logs: (rows as unknown as AuditRow[]).map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt.toISOString(),
        action: entry.action,
        targetId: entry.targetId,
        detail: entry.detail ?? null,
        actor: entry.actor ? { displayName: entry.actor.displayName, qqUin: entry.actor.qqUin.toString() } : null,
      })),
    };
  });
}