/**
 * HelloWorld 插件 — 参考实现
 *
 * 演示插件系统的核心功能：
 * - 权限声明与校验
 * - 生命周期钩子（onInit / onReady / onClose）
 * - 事件订阅与发布
 * - 插件间请求/响应通信
 * - 审计日志
 *
 * 用法：
 * ```ts
 * import { helloWorldPlugin } from "./hello-world-plugin";
 * registry.register(helloWorldPlugin);
 * ```
 */
import type { CampuxPlugin, PluginContext } from "./types";

export const helloWorldPlugin: CampuxPlugin = {
  name: "campux-plugin-helloworld",
  version: "1.0.0",
  description: "一个演示插件系统核心功能的 HelloWorld 参考插件",

  // 权限声明：注册时校验，未知权限会拒绝注册
  permissions: {
    required: ["events:emit", "events:listen", "config:read"],
    riskLevel: "low",
    rationale: "需要监听和发布事件以演示事件系统，读取配置以展示 config:read 权限",
  },

  hooks: {
    /** 服务启动时调用（路由注册前） */
    onInit(ctx: PluginContext): void {
      ctx.logger.info("HelloWorld 插件正在初始化...");

      // 读取配置（演示 config:read 权限）
      const serverPort = ctx.config.CAMPUX_SERVER_PORT;
      ctx.logger.info(`当前服务端口: ${serverPort}`);

      // 订阅事件（演示 events:listen 权限）
      ctx.events.on("post:created", (event) => {
        ctx.logger.info(
          `[事件] 收到新投稿: postId=${event.postId} tenantId=${event.tenantId}`,
        );
      });

      // 订阅通配符事件
      ctx.events.on("*", (event) => {
        ctx.logger.debug(`[通配符] 收到事件: type=${event.type}`);
      });

      // 注册请求处理器（演示插件间通信）
      ctx.events.onRequest("hello:greet", (req) => {
        ctx.logger.info(`收到请求: action=${req.action} from=${req.source}`);
        return {
          requestId: req.requestId,
          source: "campux-plugin-helloworld",
          success: true,
          data: {
            message: `Hello from HelloWorld plugin! You said: ${JSON.stringify(req.payload)}`,
            timestamp: Date.now(),
          },
        };
      });

      ctx.logger.info("HelloWorld 插件初始化完成");
    },

    /** 所有路由注册完成后调用 */
    onReady(ctx: PluginContext): void {
      ctx.logger.info("HelloWorld 插件已就绪");

      // 发布事件（演示 events:emit 权限）
      ctx.events.emit({
        type: "helloworld:ready" as any,
        pluginName: "campux-plugin-helloworld",
        version: "1.0.0",
      });
    },

    /** 服务关闭时调用 */
    onClose(ctx: PluginContext): void {
      ctx.logger.info("HelloWorld 插件正在关闭");
    },
  },
};