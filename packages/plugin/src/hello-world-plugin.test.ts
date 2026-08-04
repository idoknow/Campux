/**
 * HelloWorld 插件集成测试
 *
 * 真实运行 HelloWorld 插件，验证插件系统的完整功能：
 * - 权限声明与校验
 * - 生命周期钩子
 * - 事件订阅与发布
 * - 插件间请求/响应通信
 * - 审计日志
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { createPluginRegistry } from "./registry";
import { helloWorldPlugin } from "./hello-world-plugin";
import type { PluginRegistry, PluginContext } from "./types";

// ============================================================================
// Mock helpers
// ============================================================================

function createMockLogger() {
  const logs: string[] = [];
  const logger = {
    info: mock((msg: string) => logs.push(`[INFO] ${msg}`)),
    warn: mock((msg: string) => logs.push(`[WARN] ${msg}`)),
    error: mock((msg: string) => logs.push(`[ERROR] ${msg}`)),
    debug: mock((msg: string) => logs.push(`[DEBUG] ${msg}`)),
    fatal: mock(() => {}),
    trace: mock(() => {}),
    silent: mock(() => {}),
    child: () => logger,
    level: "info" as const,
  };
  return { logger, logs };
}

function createMockApp() {
  const { logger } = createMockLogger();
  return {
    log: logger,
  } as unknown as import("fastify").FastifyInstance;
}

function createMockQueue() {
  return { registerWorker: mock(() => {}) };
}

function createMockDb() {
  return {} as unknown as import("@campux/db").PrismaClientType;
}

// ============================================================================
// HelloWorld 插件集成测试
// ============================================================================

describe("HelloWorld 插件集成测试", () => {
  let registry: PluginRegistry;
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    app = createMockApp();
    registry = createPluginRegistry(
      app,
      { CAMPUX_SERVER_PORT: 8989 } as any,
      createMockDb(),
      createMockQueue(),
    );
  });

  // ─── 注册与权限 ────────────────────────────────────────

  test("HelloWorld 插件注册成功", () => {
    expect(() => registry.register(helloWorldPlugin)).not.toThrow();

    const plugin = registry.get("campux-plugin-helloworld");
    expect(plugin).toBeDefined();
    expect(plugin!.name).toBe("campux-plugin-helloworld");
    expect(plugin!.version).toBe("1.0.0");
    expect(plugin!.description).toContain("HelloWorld");
  });

  test("HelloWorld 插件权限声明正确", () => {
    registry.register(helloWorldPlugin);

    const perms = registry.listPermissions();
    const hw = perms.find((p) => p.name === "campux-plugin-helloworld");
    expect(hw).toBeDefined();
    expect(hw!.permissions!.required).toEqual([
      "events:emit",
      "events:listen",
      "config:read",
    ]);
    expect(hw!.permissions!.riskLevel).toBe("low");
    expect(hw!.permissions!.rationale).toBeDefined();
  });

  test("HelloWorld 插件权限校验通过", () => {
    registry.register(helloWorldPlugin);

    const missing = registry.checkPermissions("campux-plugin-helloworld");
    expect(missing).toEqual([]);
  });

  test("HelloWorld 插件默认启用", () => {
    registry.register(helloWorldPlugin);

    expect(registry.getStatus("campux-plugin-helloworld")).toBe("enabled");
  });

  // ─── 生命周期 ──────────────────────────────────────────

  test("onInit 被调用并读取配置", async () => {
    registry.register(helloWorldPlugin);

    await registry.initAll();

    // 验证 info 日志包含初始化信息
    const infoCalls = (app.log.info as ReturnType<typeof mock>).mock.calls;
    const initMessages = infoCalls.map((c: unknown[]) => c[0] as string);

    expect(initMessages.some((m: string) => m.includes("HelloWorld 插件正在初始化"))).toBe(true);
    expect(initMessages.some((m: string) => m.includes("当前服务端口:"))).toBe(true);
    expect(initMessages.some((m: string) => m.includes("HelloWorld 插件初始化完成"))).toBe(true);
  });

  test("onReady 被调用并发布事件", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();

    const receivedEvents: Array<{ type: string; pluginName: string; version: string }> = [];
    const bus = registry.getEventBus();
    bus.on("*", (e) => {
      if (e.type === "helloworld:ready") receivedEvents.push(e as any);
    });

    await registry.readyAll();

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]!.pluginName).toBe("campux-plugin-helloworld");
    expect(receivedEvents[0]!.version).toBe("1.0.0");
  });

  test("onClose 被调用", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();
    await registry.readyAll();

    await registry.closeAll();

    const infoCalls = (app.log.info as ReturnType<typeof mock>).mock.calls;
    const closeMessages = infoCalls
      .map((c: unknown[]) => c[0] as string)
      .filter((m: string) => m.includes("正在关闭"));

    expect(closeMessages.length).toBe(1);
  });

  // ─── 事件订阅 ──────────────────────────────────────────

  test("HelloWorld 插件接收 post:created 事件", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();

    const bus = registry.getEventBus();
    bus.emit({
      type: "post:created",
      tenantId: "tenant-1",
      postId: "post-42",
    });

    // 验证 HelloWorld 的 onInit 中注册的 handler 被触发
    const infoCalls = (app.log.info as ReturnType<typeof mock>).mock.calls;
    const eventLog = infoCalls
      .map((c: unknown[]) => c[0] as string)
      .find((m: string) => m.includes("收到新投稿"));

    expect(eventLog).toBeDefined();
    expect(eventLog).toContain("postId=post-42");
    expect(eventLog).toContain("tenantId=tenant-1");
  });

  test("通配符监听器接收所有事件", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();

    const bus = registry.getEventBus();
    bus.emit({ type: "tenant:created", tenantId: "t1" });
    bus.emit({ type: "tenant:paused", tenantId: "t1" });

    const debugCalls = (app.log.debug as ReturnType<typeof mock>).mock.calls;
    const wildcardLogs = debugCalls
      .map((c: unknown[]) => c[0] as string)
      .filter((m: string) => m.includes("[通配符]"));

    expect(wildcardLogs.length).toBeGreaterThanOrEqual(2);
  });

  // ─── 插件间请求/响应 ───────────────────────────────────

  test("hello:greet 请求返回问候响应", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();

    const bus = registry.getEventBus();
    const response = await bus.request({
      requestId: "req-greet-1",
      source: "test-runner",
      action: "hello:greet",
      payload: { name: "World", language: "zh" },
    });

    expect(response.success).toBe(true);
    expect(response.source).toBe("campux-plugin-helloworld");
    expect(response.data).toBeDefined();

    const data = response.data as any;
    expect(data.message).toContain("Hello from HelloWorld plugin");
    expect(data.message).toContain("World");
    expect(data.timestamp).toBeTypeOf("number");
  });

  test("hello:greet 无 handler 时返回失败", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();

    const bus = registry.getEventBus();
    const response = await bus.request({
      requestId: "req-002",
      source: "test-runner",
      action: "unknown:action",
      payload: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toContain("No handler registered");
  });

  // ─── 审计日志 ──────────────────────────────────────────

  test("完整生命周期产生审计日志", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();
    await registry.readyAll();

    const log = registry.getAuditLog();

    // 应该有注册记录
    const regEntry = log.find(
      (e) => e.action === "plugin:registered" && e.pluginName === "campux-plugin-helloworld",
    );
    expect(regEntry).toBeDefined();
    expect(regEntry!.detail).toContain("v1.0.0");
    expect(regEntry!.metadata).toBeDefined();
    expect((regEntry!.metadata as any).riskLevel).toBe("low");
  });

  test("禁用再启用产生状态变更审计日志", async () => {
    registry.register(helloWorldPlugin);

    registry.setStatus("campux-plugin-helloworld", "disabled");
    registry.setStatus("campux-plugin-helloworld", "enabled");

    const log = registry.getAuditLog();
    const statusChanges = log.filter(
      (e) => e.action === "plugin:status_changed" && e.pluginName === "campux-plugin-helloworld",
    );

    expect(statusChanges).toHaveLength(2);
    expect(statusChanges[0]!.detail).toBe("enabled → disabled");
    expect(statusChanges[1]!.detail).toBe("disabled → enabled");
  });

  // ─── 禁用插件跳过生命周期 ──────────────────────────────

  test("禁用后 initAll 跳过该插件", async () => {
    registry.register(helloWorldPlugin);
    registry.setStatus("campux-plugin-helloworld", "disabled");

    await registry.initAll();

    // 验证 info 日志包含跳过信息
    const infoCalls = (app.log.info as ReturnType<typeof mock>).mock.calls;
    const skipMessages = infoCalls
      .map((c: unknown[]) => c[0] as string)
      .filter((m: string) => m.includes("skipping disabled"));

    expect(skipMessages.length).toBe(1);
    expect(skipMessages[0]).toContain("campux-plugin-helloworld");
  });

  test("禁用后 readyAll 跳过该插件", async () => {
    registry.register(helloWorldPlugin);
    await registry.initAll();
    registry.setStatus("campux-plugin-helloworld", "disabled");

    // 监听 helloworld:ready 事件
    const receivedEvents: any[] = [];
    const bus = registry.getEventBus();
    bus.on("helloworld:ready" as any, (e) => receivedEvents.push(e));

    await registry.readyAll();

    // 禁用后不应发布 helloworld:ready 事件
    expect(receivedEvents).toHaveLength(0);
  });
});