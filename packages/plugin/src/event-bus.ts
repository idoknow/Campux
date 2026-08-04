import type { EventBus, EventHandler, PluginEvent, PluginRequest, PluginResponse, PluginRequestHandler, PluginAuditEntry } from "./types";

const MAX_EVENT_LOG = 200;
const MAX_AUDIT_LOG = 500;
const DEFAULT_REQUEST_TIMEOUT = 10_000;

type EventLogEntry = { timestamp: number; event: PluginEvent };

/**
 * 事件总线实现。
 * 支持同步 emit（fire-and-forget）和异步 emitAsync（等待所有 handler）。
 * 支持插件间标准化请求/响应通信。
 * 保留最近的事件日志和审计日志用于调试和管理面板查看。
 */
export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<EventHandler>>();
  const requestHandlers = new Map<string, Set<PluginRequestHandler>>();
  const eventLog: EventLogEntry[] = [];
  const auditLog: PluginAuditEntry[] = [];

  function recordEvent(event: PluginEvent): void {
    eventLog.push({ timestamp: Date.now(), event });
    if (eventLog.length > MAX_EVENT_LOG) {
      eventLog.splice(0, eventLog.length - MAX_EVENT_LOG);
    }
  }

  function recordAudit(entry: PluginAuditEntry): void {
    auditLog.push(entry);
    if (auditLog.length > MAX_AUDIT_LOG) {
      auditLog.splice(0, auditLog.length - MAX_AUDIT_LOG);
    }
  }

  function getHandlers(eventType: string): Set<EventHandler> {
    let set = listeners.get(eventType);
    if (!set) {
      set = new Set();
      listeners.set(eventType, set);
    }
    return set;
  }

  return {
    on(eventType: string, handler: EventHandler): () => void {
      const set = getHandlers(eventType);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    emit(event: PluginEvent): void {
      // 内部审计事件：直接记录到审计日志
      if (event.type === "_audit:entry") {
        const auditEntry = event as unknown as PluginAuditEntry & { type: string };
        const entry: PluginAuditEntry = {
          timestamp: auditEntry.timestamp,
          action: auditEntry.action,
          pluginName: auditEntry.pluginName,
        };
        if (auditEntry.operator !== undefined) entry.operator = auditEntry.operator;
        if (auditEntry.detail !== undefined) entry.detail = auditEntry.detail;
        if (auditEntry.metadata !== undefined) entry.metadata = auditEntry.metadata;
        recordAudit(entry);
        return;
      }

      recordEvent(event);
      // 通知精确匹配的监听器
      const exact = listeners.get(event.type);
      if (exact) {
        for (const handler of exact) {
          try {
            handler(event);
          } catch (err) {
            // 事件处理错误不应中断其他 handler
            console.error(`[EventBus] handler error for "${event.type}":`, err);
          }
        }
      }
      // 通知通配符监听器
      const wildcard = listeners.get("*");
      if (wildcard) {
        for (const handler of wildcard) {
          try {
            handler(event);
          } catch (err) {
            console.error(`[EventBus] wildcard handler error for "${event.type}":`, err);
          }
        }
      }
    },

    async emitAsync(event: PluginEvent): Promise<void> {
      recordEvent(event);
      const handlers: EventHandler[] = [];
      const exact = listeners.get(event.type);
      if (exact) handlers.push(...exact);
      const wildcard = listeners.get("*");
      if (wildcard) handlers.push(...wildcard);

      await Promise.all(
        handlers.map((handler) =>
          Promise.resolve(handler(event)).catch((err) => {
            console.error(`[EventBus] async handler error for "${event.type}":`, err);
          })
        )
      );
    },

    removeAllListeners(): void {
      listeners.clear();
    },

    getRecentEvents(maxEntries = 50): ReadonlyArray<EventLogEntry> {
      return eventLog.slice(-maxEntries);
    },

    async request(req: PluginRequest, timeoutMs = DEFAULT_REQUEST_TIMEOUT): Promise<PluginResponse> {
      recordAudit({
        timestamp: Date.now(),
        action: "plugin:request_sent",
        pluginName: req.source,
        detail: `action=${req.action} target=${req.target ?? "(broadcast)"}`,
        metadata: { requestId: req.requestId, action: req.action },
      });

      const handlers = requestHandlers.get(req.action);
      if (!handlers || handlers.size === 0) {
        const response: PluginResponse = {
          requestId: req.requestId,
          source: "event-bus",
          success: false,
          error: `No handler registered for action "${req.action}"`,
        };
        recordAudit({
          timestamp: Date.now(),
          action: "plugin:response_received",
          pluginName: req.source,
          detail: `no handler for action=${req.action}`,
          metadata: { requestId: req.requestId },
        });
        return response;
      }

      // 超时竞速
      const timeoutPromise = new Promise<PluginResponse>((resolve) => {
        setTimeout(() => {
          resolve({
            requestId: req.requestId,
            source: "system-bus",
            success: false,
            error: `Request timed out after ${timeoutMs}ms`,
          });
        }, timeoutMs);
      });

      // 向所有匹配的 handler 发送请求，取第一个成功响应
      const handlerPromises = [...handlers].map(async (handler) => {
        try {
          const result = await handler(req);
          if (result.success) {
            recordAudit({
              timestamp: Date.now(),
              action: "plugin:response_received",
              pluginName: req.source,
              detail: `success from ${result.source} for "${req.action}"`,
              metadata: { requestId: req.requestId, responder: result.source },
            });
            return result;
          }
          return null;
        } catch (err) {
          recordAudit({
            timestamp: Date.now(),
            action: "plugin:error",
            pluginName: req.source,
            detail: `handler error for "${req.action}": ${String(err)}`,
            metadata: { requestId: req.requestId },
          });
          return null;
        }
      });

      const firstSuccess = Promise.race([
        ...handlerPromises,
        timeoutPromise,
      ]);

      const result = await firstSuccess;
      if (result && result.success) return result;

      // 如果超时先触发，直接返回超时结果
      if (result && !result.success && result.source === "system-bus") {
        return result;
      }

      // 等待所有 handler 完成，看是否有成功的
      const allResults = await Promise.all(handlerPromises);
      const successResult = allResults.find((r) => r !== null);
      if (successResult) return successResult;

      return {
        requestId: req.requestId,
        source: "system-bus",
        success: false,
        error: "All handlers failed or returned unsuccessful responses",
      };
    },

    onRequest(action: string, handler: PluginRequestHandler): () => void {
      let set = requestHandlers.get(action);
      if (!set) {
        set = new Set();
        requestHandlers.set(action, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    },

    getAuditLog(maxEntries = 50): ReadonlyArray<PluginAuditEntry> {
      return auditLog.slice(-maxEntries);
    },
  };
}