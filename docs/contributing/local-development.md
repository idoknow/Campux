# 本地开发

> 本页面向**参与 Campux 开发的贡献者**。只想部署自托管实例的维护者请看[部署与快速开始](/getting-started)。

开发时可以把前端、后端和基础设施拆开启动，配合热更新和测试账号迭代。

## 启动开发环境

使用本仓库的基础设施 compose 起 PostgreSQL、MinIO 等依赖，再分别启动前后端：

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
| `50000` | 运营管理员 | 运营面板和范围化租户管理验证 |

`db:seed` 会创建弱密码测试账号（含系统运维），因此**在 `NODE_ENV=production` 下默认拒绝执行**；确需在生产库植入演示数据时，显式设置 `CAMPUX_ALLOW_SEED=true`。生产环境也会隐藏开发测试登录提示，并要求真实账号通过机器人注册或由管理员授权。

## 跳过初始化向导

种子数据已经包含系统运维账号，因此开发实例不会进入「初始化 Campux」向导，可以直接用上面的测试账号登录。如果想体验初始化向导本身，清空数据库后跳过 `bun run db:seed` 即可让实例回到全新状态。
