import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";
import type { PrismaClientType } from "@campux/db";
import type {
  CampuxPlugin,
  PluginContext,
  PluginRegistry,
  PluginLogger,
  PluginQueue,
  PluginRuntimeStatus,
  PluginPermission,
  PluginAuditEntry,
} from "./types";
import { createEventBus } from "./event-bus";
import type { EventBus } from "./types";

/** 所有可声明的权限 */
const ALL_PERMISSIONS: PluginPermission[] = [
  "db:read",
  "db:write",
  "events:emit",
  "events:listen",
  "http:route",
  "queue:worker",
  "config:read",
  "tenant:data",
  "user:data",
];

/** 高风险权限：注册时需要额外警告 */
const HIGH_RISK_PERMISSIONS: PluginPermission[] = [
  "db:write",
  "http:route",
  "user:data",
];

/**
 * 创建插件日志器（带插件名前缀）
 */
function createPluginLogger(baseLogger: FastifyInstance["log"], pluginName: string): PluginLogger {
  const child = baseLogger.child({ plugin: pluginName });
  const log = child as unknown as {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
    debug: (msg: string, ...args: unknown[]) => void;
  };
  return {
    info: (msg, ...args) => log.info(msg, ...args),
    warn: (msg, ...args) => log.warn(msg, ...args),
    error: (msg, ...args) => log.error(msg, ...args),
    debug: (msg, ...args) => log.debug(msg, ...args),
  };
}

/**
 * 创建插件注册表。
 *
 * 用法：
 * ```ts
 * const registry = createPluginRegistry(app, config, db, queue);
 * registry.register(myPlugin);
 * await registry.initAll(ctx);
 * // ... 注册路由 ...
 * await registry.readyAll(ctx);
 * ```
 */
export function createPluginRegistry(
  app: FastifyInstance,
  config: CampuxConfig,
  db: PrismaClientType,
  queue: PluginQueue,
): PluginRegistry {
  const plugins = new Map<string, CampuxPlugin>();
  const statuses = new Map<string, PluginRuntimeStatus>();
  const events = createEventBus();

  function recordAudit(entry: PluginAuditEntry): void {
    // 通过内部审计事件写入审计日志
    events.emit({ type: "_audit:entry", ...entry } as unknown as Parameters<typeof events.emit>[0]);
  }

  function isEnabled(name: string): boolean {
    return statuses.get(name) !== "disabled";
  }

  function buildContext(plugin: CampuxPlugin): PluginContext {
    return {
      app,
      config,
      db,
      events,
      logger: createPluginLogger(app.log, plugin.name),
      queue,
    };
  }

  return {
    register(plugin: CampuxPlugin): void {
      if (plugins.has(plugin.name)) {
        throw new Error(`Plugin "${plugin.name}" is already registered`);
      }

      // 校验权限声明
      if (plugin.permissions) {
        const invalidPerms = plugin.permissions.required.filter(
          (p) => !ALL_PERMISSIONS.includes(p)
        );
        if (invalidPerms.length > 0) {
          throw new Error(
            `Plugin "${plugin.name}" declares unknown permissions: ${invalidPerms.join(", ")}`
          );
        }

        // 高风险权限警告
        const highRisk = plugin.permissions.required.filter((p) =>
          HIGH_RISK_PERMISSIONS.includes(p)
        );
        if (highRisk.length > 0) {
          app.log.warn(
            `[PluginRegistry] plugin "${plugin.name}" requests high-risk permissions: ${highRisk.join(", ")}`
          );
        }
      }

      plugins.set(plugin.name, plugin);
      const initialStatus: PluginRuntimeStatus = plugin.enabledByDefault !== false ? "enabled" : "disabled";
      statuses.set(plugin.name, initialStatus);

      // 审计日志
      events.getAuditLog; // ensure audit log exists
      recordAudit({
        timestamp: Date.now(),
        action: "plugin:registered",
        pluginName: plugin.name,
        detail: `v${plugin.version} status=${initialStatus} risk=${plugin.permissions?.riskLevel ?? "unknown"}`,
        metadata: {
          version: plugin.version,
          status: initialStatus,
          permissions: plugin.permissions?.required ?? [],
          riskLevel: plugin.permissions?.riskLevel ?? "unknown",
        },
      });

      app.log.info(`[PluginRegistry] registered plugin "${plugin.name}" v${plugin.version} (${initialStatus})`);
    },

    list(): ReadonlyArray<CampuxPlugin> {
      return [...plugins.values()];
    },

    get(name: string): CampuxPlugin | undefined {
      return plugins.get(name);
    },

    getEventBus(): EventBus {
      return events;
    },

    getStatus(name: string): PluginRuntimeStatus {
      return statuses.get(name) ?? "enabled";
    },

    setStatus(name: string, status: PluginRuntimeStatus): void {
      if (!plugins.has(name)) {
        throw new Error(`Plugin "${name}" is not registered`);
      }
      const previous = statuses.get(name) ?? "enabled";
      statuses.set(name, status);
      recordAudit({
        timestamp: Date.now(),
        action: "plugin:status_changed",
        pluginName: name,
        detail: `${previous} → ${status}`,
        metadata: { previous, current: status },
      });
      app.log.info(`[PluginRegistry] plugin "${name}" status changed: ${previous} → ${status}`);
    },

    listStatuses(): ReadonlyMap<string, PluginRuntimeStatus> {
      return statuses;
    },

    async initAll(ctx?: PluginContext): Promise<void> {
      for (const plugin of plugins.values()) {
        if (!isEnabled(plugin.name)) {
          app.log.info(`[PluginRegistry] skipping disabled plugin "${plugin.name}"`);
          continue;
        }
        const pctx = ctx ?? buildContext(plugin);
        if (plugin.hooks?.onInit) {
          app.log.info(`[PluginRegistry] initializing plugin "${plugin.name}"`);
          try {
            await plugin.hooks.onInit(pctx);
          } catch (err) {
            app.log.error(`[PluginRegistry] plugin "${plugin.name}" onInit failed: ${String(err)}`);
            throw err;
          }
        }
      }
    },

    async readyAll(ctx?: PluginContext): Promise<void> {
      for (const plugin of plugins.values()) {
        if (!isEnabled(plugin.name)) continue;
        const pctx = ctx ?? buildContext(plugin);
        if (plugin.hooks?.onReady) {
          app.log.info(`[PluginRegistry] readying plugin "${plugin.name}"`);
          try {
            await plugin.hooks.onReady(pctx);
          } catch (err) {
            app.log.error(`[PluginRegistry] plugin "${plugin.name}" onReady failed: ${String(err)}`);
            // onReady 失败不中断其他插件
          }
        }
      }
    },

    checkPermissions(pluginName: string): PluginPermission[] {
      const plugin = plugins.get(pluginName);
      if (!plugin) return [];
      if (!plugin.permissions) return [];

      const declared = plugin.permissions.required;
      const missing: PluginPermission[] = [];

      // 检查每个声明的权限是否在允许列表中
      for (const perm of declared) {
        if (!ALL_PERMISSIONS.includes(perm)) {
          missing.push(perm);
        }
      }

      if (missing.length > 0) {
        recordAudit({
          timestamp: Date.now(),
          action: "plugin:permission_check",
          pluginName,
          detail: `missing permissions: ${missing.join(", ")}`,
          metadata: { missing },
        });
      }

      return missing;
    },

    listPermissions() {
      return [...plugins.entries()].map(([name, plugin]) => ({
        name,
        permissions: plugin.permissions ?? null,
      }));
    },

    getAuditLog(maxEntries = 50): ReadonlyArray<PluginAuditEntry> {
      return events.getAuditLog(maxEntries);
    },

    async closeAll(ctx?: PluginContext): Promise<void> {
      for (const plugin of plugins.values()) {
        const pctx = ctx ?? buildContext(plugin);
        if (plugin.hooks?.onClose) {
          app.log.info(`[PluginRegistry] closing plugin "${plugin.name}"`);
          try {
            await plugin.hooks.onClose(pctx);
          } catch (err) {
            app.log.error(`[PluginRegistry] plugin "${plugin.name}" onClose failed: ${String(err)}`);
          }
        }
      }
      events.removeAllListeners();
    },
  };
}

export { createEventBus } from "./event-bus";