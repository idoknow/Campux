# 插件开发指南

本指南介绍如何开发一个 Campux 插件。

## 快速开始

### 1. 创建插件文件

在 `packages/plugin/src/` 下创建你的插件文件，例如 `my-plugin.ts`：

```ts
import type { CampuxPlugin, PluginContext } from "./types";

export const myPlugin: CampuxPlugin = {
  name: "campux-plugin-myplugin",
  version: "1.0.0",
  description: "我的第一个 Campux 插件",

  permissions: {
    required: ["events:listen", "config:read"],
    riskLevel: "low",
    rationale: "需要监听投稿事件并读取配置",
  },

  hooks: {
    onInit(ctx) {
      ctx.logger.info("MyPlugin 初始化");
    },
    onReady(ctx) {
      ctx.logger.info("MyPlugin 已就绪");
    },
    onClose(ctx) {
      ctx.logger.info("MyPlugin 关闭");
    },
  },
};
```

### 2. 注册插件

在服务启动代码中注册插件：

```ts
import { createPluginRegistry } from "@campux/plugin";
import { myPlugin } from "./my-plugin";

const registry = createPluginRegistry(app, config, db, queue);

// 注册
registry.register(myPlugin);

// 初始化（路由注册前）
await registry.initAll();

// ... 注册路由 ...

// 就绪
await registry.readyAll();
```

### 3. 导出插件

在 `packages/plugin/src/index.ts` 中导出你的插件：

```ts
export { myPlugin } from "./my-plugin";
```

## 权限声明

每个插件必须声明所需权限。权限在注册时校验：

```ts
permissions: {
  required: ["events:listen", "db:read"],  // 需要的权限列表
  riskLevel: "medium",                       // low | medium | high
  rationale: "需要读取投稿数据以生成统计报告", // 权限说明
}
```

**权限选择原则：**

- 只声明实际需要的权限，不要过度声明
- 高风险权限（`db:write`、`http:route`、`user:data`）需要特别说明理由
- 未知权限会导致注册失败

## 生命周期钩子

### onInit

服务启动时调用，在路由注册之前。适合：

- 初始化外部连接（数据库、缓存等）
- 订阅事件
- 注册请求处理器
- 读取配置

```ts
onInit(ctx: PluginContext): void {
  // 订阅投稿创建事件
  ctx.events.on("post:created", (event) => {
    ctx.logger.info(`新投稿: ${event.postId}`);
  });

  // 注册请求处理器
  ctx.events.onRequest("myplugin:getData", async (req) => {
    return {
      requestId: req.requestId,
      source: "my-plugin",
      success: true,
      data: { /* ... */ },
    };
  });
}
```

### onReady

所有路由注册完成后调用。适合：

- 发布就绪事件
- 启动后台定时任务
- 执行需要路由已就绪的初始化

```ts
onReady(ctx: PluginContext): void {
  ctx.events.emit({
    type: "myplugin:ready",
    pluginName: "my-plugin",
  });
}
```

### onClose

服务关闭时调用。适合：

- 关闭外部连接
- 清理资源
- 保存状态

```ts
onClose(ctx: PluginContext): void {
  ctx.logger.info("正在清理资源...");
}
```

## 事件系统

### 订阅事件

```ts
// 订阅特定事件
const unsubscribe = ctx.events.on("post:created", (event) => {
  // event 的类型会根据 "post:created" 自动推断
  console.log(event.postId, event.tenantId);
});

// 取消订阅
unsubscribe();

// 订阅所有事件（通配符）
ctx.events.on("*", (event) => {
  ctx.logger.debug(`收到事件: ${event.type}`);
});
```

### 发布事件

```ts
// 发布内置事件
ctx.events.emit({
  type: "post:created",
  tenantId: "tenant-1",
  postId: "post-42",
});

// 发布自定义事件
ctx.events.emit({
  type: "myplugin:custom_event",
  data: { key: "value" },
} as any);

// 异步发布（等待所有 handler 完成）
await ctx.events.emitAsync(event);
```

### 插件间请求/响应

```ts
// 注册请求处理器
ctx.events.onRequest("greet:hello", (req) => {
  return {
    requestId: req.requestId,
    source: "my-plugin",
    success: true,
    data: { message: `Hello, ${req.payload}` },
  };
});

// 发送请求
const response = await ctx.events.request({
  requestId: crypto.randomUUID(),
  source: "my-plugin",
  action: "greet:hello",
  payload: { name: "World" },
});

if (response.success) {
  console.log(response.data);
}
```

## 使用上下文资源

### 日志

```ts
ctx.logger.info("信息日志");
ctx.logger.warn("警告日志");
ctx.logger.error("错误日志");
ctx.logger.debug("调试日志");
```

日志自动带插件名前缀，方便过滤和排查。

### 配置

```ts
const port = ctx.config.CAMPUX_SERVER_PORT;
const dbUrl = ctx.config.DATABASE_URL;
```

需要 `config:read` 权限。

### 数据库

```ts
// 读取数据（需要 db:read 权限）
const posts = await ctx.db.post.findMany({
  where: { tenantId: "xxx" },
});

// 写入数据（需要 db:write 权限）
await ctx.db.auditLog.create({
  data: { /* ... */ },
});
```

### HTTP 路由

```ts
// 需要 http:route 权限
ctx.app.get("/api/plugin/myplugin", async (request, reply) => {
  return { status: "ok" };
});
```

### 后台 Worker

```ts
// 需要 queue:worker 权限
ctx.queue.registerWorker(
  "my-worker",
  async () => {
    // 定时执行的任务
    ctx.logger.info("worker 执行中...");
  },
  60_000, // 每 60 秒执行一次
);
```

## 插件状态管理

管理员可以通过注册表管理插件状态：

```ts
// 禁用插件
registry.setStatus("my-plugin", "disabled");

// 启用插件
registry.setStatus("my-plugin", "enabled");

// 查看状态
const status = registry.getStatus("my-plugin");

// 查看所有状态
const allStatuses = registry.listStatuses();
```

禁用后，`initAll()` 和 `readyAll()` 会跳过该插件。

## 审计日志

所有插件操作自动记录审计日志。查询审计日志：

```ts
// 获取最近 50 条审计日志
const logs = registry.getAuditLog(50);

// 从事件总线获取
const logs = events.getAuditLog(100);
```

## 测试

参考 `hello-world-plugin.test.ts` 编写集成测试：

```ts
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { createPluginRegistry } from "./registry";
import { myPlugin } from "./my-plugin";

describe("MyPlugin", () => {
  let registry;

  beforeEach(() => {
    const app = createMockApp();
    registry = createPluginRegistry(app, mockConfig, mockDb, mockQueue);
  });

  test("注册成功", () => {
    expect(() => registry.register(myPlugin)).not.toThrow();
  });

  test("权限校验通过", () => {
    registry.register(myPlugin);
    expect(registry.checkPermissions("my-plugin")).toEqual([]);
  });

  test("生命周期钩子被调用", async () => {
    registry.register(myPlugin);
    await registry.initAll();
    // 验证 onInit 被调用
  });
});
```

## 最佳实践

1. **最小权限原则**：只声明实际需要的权限
2. **错误处理**：事件 handler 中的异常不会中断其他 handler，但应在 handler 内部妥善处理
3. **日志规范**：使用 `ctx.logger` 而非 `console.log`，确保日志带插件名前缀
4. **资源清理**：在 `onClose` 中清理外部连接、定时器等资源
5. **版本兼容**：通过 `campuxVersion` 声明兼容的 Campux 版本范围
6. **测试覆盖**：为插件的生命周期、事件处理、请求响应编写测试