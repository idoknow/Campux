import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";
import type { PrismaClientType } from "@campux/db";

// ─── 安全管控 ──────────────────────────────────────────

/** 插件可声明的权限 */
export type PluginPermission =
  | "db:read"
  | "db:write"
  | "events:emit"
  | "events:listen"
  | "http:route"
  | "queue:worker"
  | "config:read"
  | "tenant:data"
  | "user:data";

/** 插件风险等级 */
export type PluginRiskLevel = "low" | "medium" | "high";

/** 插件权限声明 */
export interface PluginPermissions {
  /** 插件需要的权限列表 */
  required: PluginPermission[];
  /** 风险等级 */
  riskLevel: PluginRiskLevel;
  /** 权限说明（为什么需要这些权限） */
  rationale?: string;
}

// ─── 插件请求/响应标准 ─────────────────────────────────

/** 插件间请求标准格式 */
export interface PluginRequest {
  /** 请求唯一 ID */
  requestId: string;
  /** 发起请求的插件名 */
  source: string;
  /** 目标插件名（不指定则广播给所有监听该 action 的插件） */
  target?: string;
  /** 请求动作 */
  action: string;
  /** 请求数据 */
  payload: unknown;
}

/** 插件间响应标准格式 */
export interface PluginResponse {
  /** 对应的请求 ID */
  requestId: string;
  /** 响应来源插件名 */
  source: string;
  /** 是否成功 */
  success: boolean;
  /** 响应数据 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
}

/** 插件请求处理器 */
export type PluginRequestHandler = (req: PluginRequest) => Promise<PluginResponse> | PluginResponse;

// ─── 审计日志 ──────────────────────────────────────────

/** 插件审计操作类型 */
export type PluginAuditAction =
  | "plugin:registered"
  | "plugin:status_changed"
  | "plugin:permission_check"
  | "plugin:request_sent"
  | "plugin:response_received"
  | "plugin:error";

/** 插件审计日志条目 */
export interface PluginAuditEntry {
  /** 时间戳 */
  timestamp: number;
  /** 操作类型 */
  action: PluginAuditAction;
  /** 插件名 */
  pluginName: string;
  /** 操作者（admin 用户名或系统） */
  operator?: string | undefined;
  /** 详细信息 */
  detail?: string | undefined;
  /** 关联数据 */
  metadata?: Record<string, unknown> | undefined;
}

// ─── 事件系统 ───────────────────────────────────────────

/** 插件系统内置事件类型 */
export type PluginEvent =
  | { type: "post:created"; tenantId: string; postId: string }
  | { type: "post:status_changed"; tenantId: string; postId: string; oldStatus: string; newStatus: string }
  | { type: "post:published"; tenantId: string; postId: string }
  | { type: "post:recalled"; tenantId: string; postId: string }
  | { type: "review:approved"; tenantId: string; postId: string; reviewerId: string }
  | { type: "review:rejected"; tenantId: string; postId: string; reviewerId: string; reason?: string }
  | { type: "tenant:created"; tenantId: string }
  | { type: "tenant:activated"; tenantId: string }
  | { type: "tenant:paused"; tenantId: string }
  | { type: "tenant:archived"; tenantId: string }
  | { type: "user:registered"; userId: string }
  | { type: "user:joined_tenant"; userId: string; tenantId: string; role: string }
  | { type: "bot:message_received"; tenantId: string; botAccountId: string; rawMessage: unknown }
  | { type: "publish:attempted"; tenantId: string; postId: string; targetType: string; success: boolean }
  // 允许插件自定义事件
  | { type: string; [key: string]: unknown };

export type EventHandler<T extends PluginEvent = PluginEvent> = (event: T) => void | Promise<void>;

/** 事件总线：发布/订阅模式 */
export interface EventBus {
  /** 订阅事件。返回取消订阅函数。当 eventType 为具体事件类型时，handler 参数类型会自动收窄。 */
  on<T extends PluginEvent["type"]>(
    eventType: T,
    handler: EventHandler<Extract<PluginEvent, { type: T }>>
  ): () => void;
  /** 订阅所有事件（通配符） */
  on(eventType: "*", handler: EventHandler): () => void;
  /** 发布事件 */
  emit(event: PluginEvent): void;
  /** 异步发布事件（等待所有 handler 完成） */
  emitAsync(event: PluginEvent): Promise<void>;
  /** 移除所有监听器 */
  removeAllListeners(): void;
  /** 获取最近的事件日志（最多 maxEntries 条） */
  getRecentEvents(maxEntries?: number): ReadonlyArray<{ timestamp: number; event: PluginEvent }>;
  /** 发送插件间请求，返回第一个成功响应 */
  request(req: PluginRequest, timeoutMs?: number): Promise<PluginResponse>;
  /** 注册请求处理器 */
  onRequest(action: string, handler: PluginRequestHandler): () => void;
  /** 获取审计日志 */
  getAuditLog(maxEntries?: number): ReadonlyArray<PluginAuditEntry>;
}

// ─── 插件上下文 ────────────────────────────────────────

/** 注入给插件的运行时上下文 */
export interface PluginContext {
  /** Fastify 实例，插件可注册路由、装饰器、钩子 */
  app: FastifyInstance;
  /** 全局配置 */
  config: CampuxConfig;
  /** Prisma 客户端 */
  db: PrismaClientType;
  /** 事件总线 */
  events: EventBus;
  /** 插件日志器（带插件名前缀） */
  logger: PluginLogger;
  /** 运行时队列（用于注册 worker） */
  queue: PluginQueue;
}

/** 插件日志器 */
export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/** 运行时队列接口（简化版，用于插件注册 worker） */
export interface PluginQueue {
  /** 注册一个后台 worker */
  registerWorker(name: string, handler: () => Promise<void>, intervalMs: number): void;
}

// ─── 插件定义 ──────────────────────────────────────────

/** 插件生命周期钩子 */
export interface PluginHooks {
  /** 服务启动时调用（路由注册前） */
  onInit?: (ctx: PluginContext) => Promise<void> | void;
  /** 所有路由注册完成后调用 */
  onReady?: (ctx: PluginContext) => Promise<void> | void;
  /** 服务关闭时调用 */
  onClose?: (ctx: PluginContext) => Promise<void> | void;
}

/** 插件运行时状态 */
export type PluginRuntimeStatus = "enabled" | "disabled";

/** 插件定义 */
export interface CampuxPlugin {
  /** 插件唯一名称，如 "campux-plugin-qzone" */
  name: string;
  /** 语义化版本 */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 生命周期钩子 */
  hooks?: PluginHooks;
  /** 兼容的 Campux 版本范围（semver），如 ">=1.0.0" */
  campuxVersion?: string;
  /** 是否默认启用（注册时生效） */
  enabledByDefault?: boolean;
  /** 插件权限声明（注册时校验） */
  permissions?: PluginPermissions;
}

// ─── 插件注册表 ────────────────────────────────────────

/** 插件注册表：管理所有已注册插件 */
export interface PluginRegistry {
  /** 注册一个插件 */
  register(plugin: CampuxPlugin): void;
  /** 获取所有已注册插件 */
  list(): ReadonlyArray<CampuxPlugin>;
  /** 按名称获取插件 */
  get(name: string): CampuxPlugin | undefined;
  /** 获取事件总线（供路由层触发事件） */
  getEventBus(): EventBus;
  /** 获取插件运行时状态 */
  getStatus(name: string): PluginRuntimeStatus;
  /** 设置插件运行时状态 */
  setStatus(name: string, status: PluginRuntimeStatus): void;
  /** 获取所有插件运行时状态 */
  listStatuses(): ReadonlyMap<string, PluginRuntimeStatus>;
  /** 初始化所有已启用插件（路由注册前） */
  initAll(ctx?: PluginContext): Promise<void>;
  /** 就绪所有已启用插件（路由注册后） */
  readyAll(ctx?: PluginContext): Promise<void>;
  /** 关闭所有插件 */
  closeAll(ctx?: PluginContext): Promise<void>;
  /** 校验插件权限：返回缺失的权限列表 */
  checkPermissions(pluginName: string): PluginPermission[];
  /** 获取所有插件的权限声明 */
  listPermissions(): ReadonlyArray<{ name: string; permissions: PluginPermissions | null }>;
  /** 获取审计日志 */
  getAuditLog(maxEntries?: number): ReadonlyArray<PluginAuditEntry>;
}