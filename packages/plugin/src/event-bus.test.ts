import { describe, expect, test, beforeEach } from "bun:test";
import { createEventBus } from "./event-bus";
import type {
  EventBus,
  PluginAuditEntry,
  PluginRequest,
  PluginResponse,
} from "./types";

// ============================================================================
// 事件总线测试
// ============================================================================

describe("createEventBus", () => {
  let bus: ReturnType<typeof createEventBus>;

  beforeEach(() => {
    bus = createEventBus();
  });

  // ─── 基本事件发布/订阅 ────────────────────────────────

  test("订阅并接收事件", () => {
    const received: PluginEvent[] = [];
    bus.on("post:created", (e) => received.push(e));

    const event: PluginEvent = {
      type: "post:created",
      tenantId: "t1",
      postId: "p1",
    };
    bus.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  test("通配符 * 接收所有事件", () => {
    const received: PluginEvent[] = [];
    bus.on("*", (e) => received.push(e));

    bus.emit({ type: "post:created", tenantId: "t1", postId: "p1" });
    bus.emit({ type: "tenant:created", tenantId: "t2" });

    expect(received).toHaveLength(2);
  });

  test("取消订阅后不再接收事件", () => {
    const received: PluginEvent[] = [];
    const unsub = bus.on("post:created", (e) => received.push(e));

    bus.emit({ type: "post:created", tenantId: "t1", postId: "p1" });
    expect(received).toHaveLength(1);

    unsub();
    bus.emit({ type: "post:created", tenantId: "t1", postId: "p2" });
    expect(received).toHaveLength(1); // 不再增长
  });

  test("removeAllListeners 清除所有监听器", () => {
    const received: PluginEvent[] = [];
    bus.on("post:created", (e) => received.push(e));
    bus.on("*", (e) => received.push(e));

    bus.removeAllListeners();
    bus.emit({ type: "post:created", tenantId: "t1", postId: "p1" });

    expect(received).toHaveLength(0);
  });

  // ─── 事件日志 ──────────────────────────────────────────

  test("getRecentEvents 返回最近事件", () => {
    bus.emit({ type: "post:created", tenantId: "t1", postId: "p1" });
    bus.emit({ type: "tenant:created", tenantId: "t2" });

    const events = bus.getRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe("post:created");
    expect(events[1]!.event.type).toBe("tenant:created");
  });

  test("getRecentEvents 支持限制条数", () => {
    for (let i = 0; i < 10; i++) {
      bus.emit({ type: "post:created", tenantId: "t1", postId: `p${i}` });
    }

    expect(bus.getRecentEvents(3)).toHaveLength(3);
  });

  // ─── 审计日志 ──────────────────────────────────────────

  test("_audit:entry 事件被拦截并记录到审计日志", () => {
    const auditEntry: PluginAuditEntry = {
      timestamp: Date.now(),
      action: "plugin:registered",
      pluginName: "test-plugin",
      detail: "v1.0.0",
    };

    // 通过内部审计事件写入
    bus.emit({
      type: "_audit:entry",
      ...auditEntry,
    } as unknown as Parameters<typeof bus.emit>[0]);

    const log = bus.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.action).toBe("plugin:registered");
    expect(log[0]!.pluginName).toBe("test-plugin");
  });

  test("审计日志不出现在 getRecentEvents 中", () => {
    bus.emit({
      type: "_audit:entry",
      timestamp: Date.now(),
      action: "plugin:registered",
      pluginName: "test",
    } as unknown as Parameters<typeof bus.emit>[0]);

    const events = bus.getRecentEvents();
    // 审计事件不应出现在普通事件日志中
    const auditEvents = events.filter((e) => e.event.type === "_audit:entry");
    expect(auditEvents).toHaveLength(0);
  });

  test("getAuditLog 支持限制条数", () => {
    for (let i = 0; i < 10; i++) {
      bus.emit({
        type: "_audit:entry",
        timestamp: Date.now(),
        action: "plugin:registered",
        pluginName: `plugin-${i}`,
      } as unknown as Parameters<typeof bus.emit>[0]);
    }

    expect(bus.getAuditLog(5)).toHaveLength(5);
  });

  test("审计日志上限为 500 条", () => {
    for (let i = 0; i < 600; i++) {
      bus.emit({
        type: "_audit:entry",
        timestamp: Date.now(),
        action: "plugin:registered",
        pluginName: `plugin-${i}`,
      } as unknown as Parameters<typeof bus.emit>[0]);
    }

    const log = bus.getAuditLog(1000);
    expect(log.length).toBeLessThanOrEqual(500);
  });

  // ─── 插件间请求/响应 ───────────────────────────────────

  test("request 发送到匹配的 handler 并返回响应", async () => {
    bus.onRequest("get-data", async (req) => ({
      requestId: req.requestId,
      source: "responder",
      success: true,
      data: { result: "ok" },
    }));

    const response = await bus.request({
      requestId: "req-1",
      source: "caller",
      action: "get-data",
      payload: { key: "value" },
    });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ result: "ok" });
  });

  test("request 无匹配 handler 返回失败", async () => {
    const response = await bus.request({
      requestId: "req-1",
      source: "caller",
      action: "nonexistent",
      payload: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toContain("No handler registered");
  });

  test("request 超时返回失败", async () => {
    // 注册一个延迟很久才响应的 handler（远超超时时间）
    bus.onRequest("slow", async () => {
      await new Promise((r) => setTimeout(r, 10000));
      return {
        requestId: "req-1",
        source: "slow-responder",
        success: true,
      };
    });

    const response = await bus.request(
      {
        requestId: "req-1",
        source: "caller",
        action: "slow",
        payload: {},
      },
      100, // 100ms 超时
    );

    expect(response.success).toBe(false);
    expect(response.error).toContain("timed out");
  });

  test("request 记录审计日志", async () => {
    bus.onRequest("get:data", async (req) => ({
      requestId: req.requestId,
      source: "responder",
      success: true,
    }));

    await bus.request({
      requestId: "req-1",
      source: "caller",
      action: "get:data",
      payload: {},
    });

    const log = bus.getAuditLog();
    // 应该有 request_sent 和 response_received 两条记录
    const requestLog = log.find((e) => e.action === "plugin:request_sent");
    const responseLog = log.find((e) => e.action === "plugin:response_received");

    expect(requestLog).toBeDefined();
    expect(requestLog!.pluginName).toBe("caller");
    expect(responseLog).toBeDefined();
  });

  test("onRequest 返回取消注册函数", async () => {
    const unsub = bus.onRequest("get:data", async (req) => ({
      requestId: req.requestId,
      source: "responder",
      success: true,
    }));

    unsub();

    const response = await bus.request({
      requestId: "req-1",
      source: "caller",
      action: "get:data",
      payload: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toContain("No handler registered");
  });

  // ─── emitAsync ─────────────────────────────────────────

  test("emitAsync 等待所有 handler 完成", async () => {
    const order: string[] = [];

    bus.on("test:event", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push("handler1");
    });
    bus.on("test:event", async () => {
      order.push("handler2");
    });

    await bus.emitAsync({ type: "test:event" } as PluginEvent);

    expect(order).toContain("handler1");
    expect(order).toContain("handler2");
  });
});