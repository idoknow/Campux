import { describe, expect, test, beforeEach, mock } from "bun:test";
import { createPluginRegistry } from "./registry";
import { createEventBus } from "./event-bus";
import type {
  CampuxPlugin,
  PluginContext,
  PluginRegistry,
  PluginPermission,
  PluginRuntimeStatus,
  PluginAuditEntry,
} from "./types";

// ============================================================================
// Mock helpers
// ============================================================================

function createMockLogger() {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    fatal: mock(() => {}),
    trace: mock(() => {}),
    silent: mock(() => {}),
    child: () => createMockLogger(),
    level: "info" as const,
  };
}

function createMockApp() {
  return {
    log: createMockLogger(),
    // 最小化 FastifyInstance mock
  } as unknown as import("fastify").FastifyInstance;
}

function createMockQueue() {
  return {
    registerWorker: mock(() => {}),
  };
}

function createMockDb() {
  return {} as unknown as import("@campux/db").PrismaClientType;
}

function createTestPlugin(overrides: Partial<CampuxPlugin> = {}): CampuxPlugin {
  return {
    name: "test-plugin",
    version: "1.0.0",
    description: "A test plugin",
    enabledByDefault: true,
    ...overrides,
  };
}

// ============================================================================
// 插件注册表测试
// ============================================================================

describe("createPluginRegistry", () => {
  let registry: PluginRegistry;
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    app = createMockApp();
    registry = createPluginRegistry(app, {} as any, createMockDb(), createMockQueue());
  });

  // ─── 基本注册 ──────────────────────────────────────────

  test("注册插件成功", () => {
    const plugin = createTestPlugin();
    registry.register(plugin);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("test-plugin")).toBe(plugin);
  });

  test("重复注册同名插件抛出错误", () => {
    registry.register(createTestPlugin({ name: "dup" }));
    expect(() => registry.register(createTestPlugin({ name: "dup" }))).toThrow(
      'Plugin "dup" is already registered',
    );
  });

  test("默认启用状态为 enabled", () => {
    registry.register(createTestPlugin());
    expect(registry.getStatus("test-plugin")).toBe("enabled");
  });

  test("enabledByDefault=false 时初始状态为 disabled", () => {
    registry.register(createTestPlugin({ enabledByDefault: false }));
    expect(registry.getStatus("test-plugin")).toBe("disabled");
  });

  // ─── 权限校验 ──────────────────────────────────────────

  test("声明有效权限的插件注册成功", () => {
    const plugin = createTestPlugin({
      name: "safe-plugin",
      permissions: {
        required: ["db:read", "events:emit"],
        riskLevel: "low",
      },
    });

    expect(() => registry.register(plugin)).not.toThrow();
  });

  test("声明未知权限的插件注册失败", () => {
    const plugin = createTestPlugin({
      name: "bad-plugin",
      permissions: {
        required: ["db:read", "unknown:perm" as PluginPermission],
        riskLevel: "low",
      },
    });

    expect(() => registry.register(plugin)).toThrow("unknown permissions");
  });

  test("高风险权限注册时产生警告日志", () => {
    const plugin = createTestPlugin({
      name: "risky-plugin",
      permissions: {
        required: ["db:write", "http:route", "user:data"],
        riskLevel: "high",
      },
    });

    registry.register(plugin);

    // 验证 warn 被调用
    const warnCalls = (app.log.warn as ReturnType<typeof mock>).mock.calls;
    const highRiskCall = warnCalls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("high-risk permissions"),
    );
    expect(highRiskCall).toBeDefined();
  });

  test("无权限声明的插件注册成功", () => {
    const plugin = createTestPlugin({ name: "no-perms" });
    expect(() => registry.register(plugin)).not.toThrow();
  });

  // ─── checkPermissions ──────────────────────────────────

  test("checkPermissions 返回空数组表示权限齐全", () => {
    registry.register(
      createTestPlugin({
        name: "safe",
        permissions: { required: ["db:read"], riskLevel: "low" },
      }),
    );

    const missing = registry.checkPermissions("safe");
    expect(missing).toEqual([]);
  });

  test("checkPermissions 对未注册插件返回空数组", () => {
    const missing = registry.checkPermissions("nonexistent");
    expect(missing).toEqual([]);
  });

  test("checkPermissions 对无权限声明的插件返回空数组", () => {
    registry.register(createTestPlugin({ name: "no-perms" }));
    const missing = registry.checkPermissions("no-perms");
    expect(missing).toEqual([]);
  });

  // ─── listPermissions ───────────────────────────────────

  test("listPermissions 返回所有插件的权限声明", () => {
    registry.register(
      createTestPlugin({
        name: "p1",
        permissions: { required: ["db:read"], riskLevel: "low" },
      }),
    );
    registry.register(createTestPlugin({ name: "p2" }));

    const perms = registry.listPermissions();
    expect(perms).toHaveLength(2);

    const p1 = perms.find((p) => p.name === "p1");
    const p2 = perms.find((p) => p.name === "p2");

    expect(p1!.permissions).not.toBeNull();
    expect(p1!.permissions!.required).toEqual(["db:read"]);
    expect(p2!.permissions).toBeNull();
  });

  // ─── 状态管理 ──────────────────────────────────────────

  test("setStatus 更新插件状态", () => {
    registry.register(createTestPlugin());
    registry.setStatus("test-plugin", "disabled");

    expect(registry.getStatus("test-plugin")).toBe("disabled");
  });

  test("setStatus 对未注册插件抛出错误", () => {
    expect(() => registry.setStatus("nonexistent", "disabled")).toThrow(
      "is not registered",
    );
  });

  test("listStatuses 返回所有状态", () => {
    registry.register(createTestPlugin({ name: "p1" }));
    registry.register(createTestPlugin({ name: "p2", enabledByDefault: false }));

    const statuses = registry.listStatuses();
    expect(statuses.get("p1")).toBe("enabled");
    expect(statuses.get("p2")).toBe("disabled");
  });

  // ─── 审计日志 ──────────────────────────────────────────

  test("注册插件产生审计日志", () => {
    registry.register(createTestPlugin({ name: "audited" }));

    const log = registry.getAuditLog();
    const regEntry = log.find((e) => e.action === "plugin:registered");
    expect(regEntry).toBeDefined();
    expect(regEntry!.pluginName).toBe("audited");
    expect(regEntry!.detail).toContain("v1.0.0");
  });

  test("状态变更产生审计日志", () => {
    registry.register(createTestPlugin());
    registry.setStatus("test-plugin", "disabled");

    const log = registry.getAuditLog();
    const statusEntry = log.find((e) => e.action === "plugin:status_changed");
    expect(statusEntry).toBeDefined();
    expect(statusEntry!.detail).toBe("enabled → disabled");
    expect(statusEntry!.metadata).toEqual({
      previous: "enabled",
      current: "disabled",
    });
  });

  test("getAuditLog 支持限制条数", () => {
    for (let i = 0; i < 10; i++) {
      registry.register(createTestPlugin({ name: `p-${i}` }));
    }

    expect(registry.getAuditLog(3)).toHaveLength(3);
  });

  // ─── 事件总线访问 ──────────────────────────────────────

  test("getEventBus 返回事件总线实例", () => {
    const bus = registry.getEventBus();
    expect(bus).toBeDefined();
    expect(typeof bus.on).toBe("function");
    expect(typeof bus.emit).toBe("function");
  });

  // ─── 生命周期 ──────────────────────────────────────────

  test("initAll 调用已启用插件的 onInit", async () => {
    const onInit = mock(async () => {});
    registry.register(createTestPlugin({ hooks: { onInit } }));

    await registry.initAll();

    expect(onInit).toHaveBeenCalledTimes(1);
  });

  test("initAll 跳过已禁用插件", async () => {
    const onInit = mock(async () => {});
    registry.register(
      createTestPlugin({ hooks: { onInit }, enabledByDefault: false }),
    );

    await registry.initAll();

    expect(onInit).toHaveBeenCalledTimes(0);
  });

  test("initAll 中 onInit 失败抛出错误", async () => {
    registry.register(
      createTestPlugin({
        hooks: { onInit: async () => { throw new Error("init failed"); } },
      }),
    );

    await expect(registry.initAll()).rejects.toThrow("init failed");
  });

  test("readyAll 调用已启用插件的 onReady", async () => {
    const onReady = mock(async () => {});
    registry.register(createTestPlugin({ hooks: { onReady } }));

    await registry.readyAll();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  test("readyAll 中 onReady 失败不中断其他插件", async () => {
    const onReadyOk = mock(async () => {});
    registry.register(
      createTestPlugin({
        name: "fail-plugin",
        hooks: { onReady: async () => { throw new Error("ready failed"); } },
      }),
    );
    registry.register(
      createTestPlugin({ name: "ok-plugin", hooks: { onReady: onReadyOk } }),
    );

    await registry.readyAll();

    // 第二个插件的 onReady 仍然被调用
    expect(onReadyOk).toHaveBeenCalledTimes(1);
  });

  test("closeAll 调用所有插件的 onClose", async () => {
    const onClose = mock(async () => {});
    registry.register(createTestPlugin({ hooks: { onClose } }));

    await registry.closeAll();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("closeAll 清除所有事件监听器", async () => {
    registry.register(createTestPlugin());
    const bus = registry.getEventBus();
    const handler = mock(() => {});
    bus.on("post:created", handler);

    await registry.closeAll();

    bus.emit({ type: "post:created", tenantId: "t1", postId: "p1" });
    expect(handler).toHaveBeenCalledTimes(0);
  });
});