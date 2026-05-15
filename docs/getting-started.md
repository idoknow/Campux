# 部署与快速开始

Campux 可以作为一个完整 Web 应用运行，也可以在开发环境中拆成前端、后端和基础设施分别启动。

## 一键自托管

仓库提供了面向演示和小规模自托管的 `docker-compose.yaml`：

```bash
cp .env.example .env
docker compose up -d
```

默认会启动：

| 服务 | 默认地址 | 说明 |
| --- | --- | --- |
| Campux | `http://localhost:8989` | Web、API、OneBot WebSocket 同一个进程 |
| PostgreSQL | `localhost:5432` | 业务数据库 |
| MinIO API | `http://localhost:9000` | 图片和渲染图对象存储 |
| MinIO Console | `http://localhost:9001` | 对象存储管理界面 |

生产环境请至少修改：

```ini
DATABASE_URL="postgresql://..."
CAMPUX_WEB_ORIGIN="https://your-domain.example"
CAMPUX_BOT_SESSION_SECRET="replace-with-a-long-random-secret"
S3_ENDPOINT="https://s3.example"
S3_BUCKET="campux"
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
S3_PUBLIC_BASE_URL="https://cdn.example/campux"
```

## 开发模式

开发时可以使用本仓库的基础设施 compose：

```bash
docker compose -f docker-compose.dev.yaml up -d
bun install
bun run db:generate
bun run db:migrate
bun run db:seed
bun run dev:server
bun run dev:web
```

开发地址：

- 前端：`http://localhost:5180`
- 后端：`http://localhost:8989`

## 默认开发账号

执行 `bun run db:seed` 后，本地会创建几个测试账号，密码均为 `campux123`：

| QQ 号 | 身份 | 用途 |
| --- | --- | --- |
| `10000` | 用户 | 投稿流程验证 |
| `20000` | 审核员 | 审核流程验证 |
| `30000` | 管理员 | 租户管理验证 |
| `40000` | 系统运维 | 运维面板验证 |

生产环境不应使用测试账号。Campux 会在生产环境隐藏开发测试登录提示，并要求真实账号通过机器人注册或由管理员授权。

## 首次检查

启动后建议依次确认：

1. `/api/health` 返回正常。
2. 能登录系统运维账号并进入运维面板。
3. 能创建或选择一个校园墙。
4. 管理页可以添加机器人，并复制 OneBot 连接 URL。
5. 发布管理页能看到发布目标和 cookies 状态。

多租户或系统运维账号登录后，会先看到校园墙选择页。普通单租户账号会直接进入所属校园墙。

![校园墙选择页](/screenshots/tenant-selection.png)

![Campux 运维面板](/screenshots/ops-panel.png)
