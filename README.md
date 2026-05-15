# Campux

Campux 是一个面向校园墙运营团队的开源管理系统。它把投稿、审核、QQ 机器人接入、QZone 发布、租户管理、封禁、统计和运维能力放在同一套 TypeScript 应用里，适合自托管给一个或多个校园墙使用。

![Campux 统计看板](./docs/public/screenshots/stats-dashboard.png)

## 适合谁使用

- 校园墙运营者：管理投稿审核、墙号机器人、发布目标、公告、投稿规则、服务入口和封禁记录。
- 系统维护者：管理多个校园墙、全局账号、租户生命周期、专属域名、审计日志和部署环境。
- 开源自托管团队：希望用 PostgreSQL、S3/MinIO、OneBot 协议端和 Docker 运行自己的校园墙系统。

Campux 当前不把终端用户手册作为文档重点。终端用户主要通过校园墙机器人注册账号，再在网页完成投稿和查看自己的稿件状态。

## 功能概览

- 多租户校园墙：一个实例管理多个校园墙，每个账号只进入被授权的校园墙。
- 投稿与审核：支持文字、图片、匿名投稿、撤回、拒绝理由、审核群通知和网页审核。
- 机器人管理：每个校园墙可配置多个 OneBot 机器人，查看连接 URL、连接状态和最近事件。
- QZone 发布：支持发布目标、风控间隔、cookies 健康检查、扫码登录、协议获取、发布日志和重试。
- 运营配置：公告、投稿规则、服务入口、品牌名、主题色、成员身份和封禁管理。
- 系统运维：租户生命周期、专属 host、全局用户、身份授权、审计日志和健康检查。
- 统计看板：投稿量、成员量、审核效率、发布质量、机器人状态和审计行为。

## 快速启动

生产或演示环境可以直接使用 Docker Compose：

```bash
cp .env.example .env
docker compose up -d
```

默认服务地址：

- Web 与 API：`http://localhost:8989`
- PostgreSQL：`localhost:5432`
- MinIO API：`http://localhost:9000`
- MinIO Console：`http://localhost:9001`

开发环境可以只启动基础设施，再分别启动前后端：

```bash
docker compose -f docker-compose.dev.yaml up -d
bun install
bun run db:generate
bun run db:migrate
bun run db:seed
bun run dev:server
bun run dev:web
```

开发环境前端默认在 `http://localhost:5180`，后端默认在 `http://localhost:8989`。

## 文档

完整文档使用 VitePress 编写，面向校园墙运营者和系统维护者：

```bash
bun run docs:dev
```

文档入口：

- [部署与快速开始](./docs/getting-started.md)
- [校园墙运营手册](./docs/operator/overview.md)
- [系统维护手册](./docs/admin/overview.md)
- [配置参考](./docs/reference/configuration.md)
- [OneBot 接入](./docs/reference/onebot.md)
- [故障排查](./docs/admin/troubleshooting.md)

## 技术栈

- Bun workspace
- Vite + React
- Fastify
- Prisma + PostgreSQL
- S3-compatible object storage
- OneBot v11 WebSocket
- Docker / Docker Compose
- VitePress documentation

## 部署注意事项

- 生产环境必须设置 `CAMPUX_BOT_SESSION_SECRET`，用于加密机器人 cookies。
- 生产环境请使用 HTTPS，session cookie 在 `NODE_ENV=production` 下会带 `Secure`。
- 应用启动时默认执行 Prisma migration；如需跳过，可设置 `CAMPUX_SKIP_AUTO_MIGRATE=true`。
- QZone 发布依赖有效 cookies，建议配置 cookies 健康检查和可人工介入的扫码登录流程。

## 许可证

Campux 使用 [Apache License 2.0](./LICENSE) 开源。
