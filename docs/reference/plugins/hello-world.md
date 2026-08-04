# HelloWorld 参考插件

`campux-plugin-helloworld` 是一个演示插件系统核心功能的参考实现。你可以将其作为模板来开发自己的插件。

## 源码

完整源码位于 `packages/plugin/src/hello-world-plugin.ts`。

## 功能演示

### 权限声明

```ts
permissions: {
  required: ["events:emit", "events:listen", "config:read"],
  riskLevel: "low",
  rationale: "需要监听和发布事件以演示事件系统，读取配置以展示 config:read 权限",
}
```

声明了三个低风险权限，注册时自动校验。

### 生命周期钩子

**onInit** — 服务启动时：

1. 读取配置 `ctx.config.CAMPUX_SERVER_PORT`（演示 `config:read` 权限）
2. 订阅 `post:created` 事件（演示 `events:listen` 权限）
3. 订阅通配符 `*` 事件
4. 注册 `hello:greet` 请求处理器（演示插件间通信）

**onReady** — 路由就绪后：

1. 发布 `helloworld:ready` 自定义事件（演示 `events:emit` 权限）

**onClose** — 服务关闭时：

1. 记录关闭日志

### 事件订阅

```ts
// 订阅投稿创建事件
ctx.events.on("post:created", (event) => {
  ctx.logger.info(
    `[事件] 收到新投稿: postId=${event.postId} tenantId=${event.tenantId}`,
  );
});

// 订阅所有事件
ctx.events.on("*", (event) => {
  ctx.logger.debug(`[通配符] 收到事件: type=${event.type}`);
});
```

### 请求/响应通信

```ts
// 注册请求处理器
ctx.events.onRequest("hello:greet", (req) => {
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
```

其他插件可以通过以下方式调用：

```ts
const response = await ctx.events.request({
  requestId: crypto.randomUUID(),
  source: "my-plugin",
  action: "hello:greet",
  payload: { name: "Campux" },
});
// response.data.message === "Hello from HelloWorld plugin! You said: {\"name\":\"Campux\"}"
```

## 测试

完整测试位于 `packages/plugin/src/hello-world-plugin.test.ts`，覆盖：

| 测试 | 说明 |
| --- | --- |
| 注册成功 | 验证插件可正常注册 |
| 权限声明正确 | 验证权限列表、风险等级、说明 |
| 权限校验通过 | `checkPermissions` 返回空数组 |
| 默认启用 | 注册后状态为 `enabled` |
| onInit 被调用 | 验证初始化日志和配置读取 |
| onReady 被调用 | 验证就绪事件发布 |
| onClose 被调用 | 验证关闭日志 |
| 接收 post:created 事件 | 验证事件订阅生效 |
| 通配符监听器 | 验证 `*` 订阅接收所有事件 |
| hello:greet 请求 | 验证请求/响应通信 |
| 无 handler 时返回失败 | 验证错误处理 |
| 完整生命周期审计 | 验证审计日志记录 |
| 状态变更审计 | 验证禁用/启用审计 |
| 禁用后跳过 initAll | 验证状态管理 |
| 禁用后跳过 readyAll | 验证状态管理 |

## 运行测试

```bash
bun test packages/plugin/src/hello-world-plugin.test.ts
```

## 作为模板使用

复制 `hello-world-plugin.ts` 作为新插件的起点：

1. 复制文件并重命名
2. 修改 `name`、`version`、`description`
3. 修改 `permissions` 为实际需要的权限
4. 在 `onInit` 中实现初始化逻辑
5. 在 `onReady` 中实现就绪逻辑
6. 在 `onClose` 中实现清理逻辑
7. 编写对应的测试文件