<p align="center">
  <img src="./docs/public/logo.svg" alt="Campux logo" width="160" height="160" />
</p>

<h1 align="center">Campux</h1>

<p align="center">开源校园墙运营系统 · 投稿、审核、QQ 机器人、QZone 发布、统计、多租户，一套自托管 TypeScript 应用。</p>

![Campux 统计看板](./docs/public/screenshots/stats-dashboard.png)

## 适合谁

主要面向**校园墙运营管理员**：自助开墙、配置机器人和发布目标、审核投稿、管理成员/公告/规则/封禁、查看统计。

- 审核员、投稿用户：在产品内按角色使用，无需阅读文档。
- 自托管系统维护者：部署、多租户生命周期、全局账号、域名与安全，见[系统维护手册](./docs/admin/overview.md)。

## 开始使用

官方服务入口 `https://app.campux.top`。从该域名访问即可用邮箱验证码注册**运营管理员**账号，然后在产品内：

1. 创建自己的校园墙
2. 添加墙号 Bot，复制 OneBot URL 到 NapCat 反向 WebSocket
3. 配置审核群、发布目标和 QZone cookies
4. 测试投稿 → 审核 → 发布闭环

完整步骤见 [自助开墙流程](./docs/operator/self-service-onboarding.md)。普通用户通过对应校园墙机器人注册，不走此入口。

## 功能

- **投稿与审核**：文字、图片、匿名投稿，撤回、拒绝理由、审核群通知、网页审核
- **机器人**：每墙多个 OneBot v11 机器人，连接 URL、状态和事件
- **QZone 发布**：发布目标、风控间隔、cookies 健康检查、扫码登录、发布日志和重试
- **运营配置**：公告、投稿规则、服务入口、品牌名、主题色、成员与封禁
- **统计看板**：投稿量、成员量、审核效率、发布质量、机器人状态
- **多租户运维**：一个实例管理多个校园墙，租户生命周期、全局账号、专属 host、审计日志

## 文档

```bash
bun run docs:dev
```

- 运营管理员：[自助开墙](./docs/operator/self-service-onboarding.md) · [运营手册](./docs/operator/overview.md) · [OneBot 接入](./docs/reference/onebot.md) · [配置参考](./docs/reference/configuration.md)
- 系统维护者：[部署与快速开始](./docs/getting-started.md) · [系统维护手册](./docs/admin/overview.md) · [故障排查](./docs/admin/troubleshooting.md)

## 自托管部署

<details>
<summary>Docker Compose 一键启动、开发模式与部署注意事项</summary>

生产或演示环境直接用 Docker Compose：

```bash
cp .env.example .env
docker compose up -d
```

默认地址：Web 与 API `:8989`、PostgreSQL `:5432`、MinIO API `:9000`、MinIO Console `:9001`。

开发模式（只起基础设施，前后端分别启动）：

```bash
docker compose -f docker-compose.dev.yaml up -d
bun install
bun run db:generate
bun run db:migrate
bun run db:seed
bun run dev:server
bun run dev:web
```

开发前端默认 `:5180`，后端默认 `:8989`。

部署注意事项：

- 生产环境必须设置 `CAMPUX_BOT_SESSION_SECRET`，用于加密机器人 cookies。
- 生产环境请使用 HTTPS，session cookie 在 `NODE_ENV=production` 下会带 `Secure`。
- 应用启动默认执行 Prisma migration，跳过可设 `CAMPUX_SKIP_AUTO_MIGRATE=true`。
- QZone 发布依赖有效 cookies，建议配置 cookies 健康检查和可人工介入的扫码登录。

</details>

## 技术栈

Bun workspace · Vite + React · Fastify · Prisma + PostgreSQL · S3 兼容存储 · OneBot v11 WebSocket · Docker · VitePress

## 许可证

[Apache License 2.0](./LICENSE)
