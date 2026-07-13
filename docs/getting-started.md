# 部署与快速开始

> 本页面向**自托管系统维护者**。使用官方服务的运营管理员请直接看[自助开墙流程](/operator/self-service-onboarding)。

Campux 可以作为一个完整 Web 应用运行，也可以在开发环境中拆成前端、后端和基础设施分别启动。

## 一键自托管

仓库提供了面向演示和小规模自托管的 `docker-compose.yaml`：

```bash
cp .env.example .env
# 生成并填入 CAMPUX_BOT_SESSION_SECRET（必填，否则容器会拒绝启动）
echo "CAMPUX_BOT_SESSION_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d
```

默认会启动：

| 服务 | 默认地址 | 说明 |
| --- | --- | --- |
| Campux | `http://localhost:8989` | Web、API、OneBot WebSocket 同一个进程 |
| PostgreSQL | `localhost:5432` | 业务数据库 |
| MinIO API | `http://localhost:9000` | 图片和渲染图对象存储 |
| MinIO Console | `http://localhost:9001` | 对象存储管理界面 |

生产环境请至少修改 `.env` 里的：

```ini
DATABASE_URL="postgresql://..."
CAMPUX_WEB_ORIGIN="https://your-domain.example"
CAMPUX_BOT_SESSION_SECRET="（openssl rand -hex 32 生成的随机串）"
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
S3_PUBLIC_BASE_URL="https://cdn.example/campux"
```

## 首次启动：初始化向导

**全新实例第一次打开会进入「初始化 Campux」向导**，不需要手动改数据库或预置账号。向导会引导你：

1. **选择部署模式**（见下）。
2. **创建第一个管理员账号**（系统运维）。单墙模式邮箱可选；多租户模式邮箱必填。
3. 单墙模式顺带填写唯一校园墙名称，完成后直接进入工作台；多租户模式完成后进入运维面板。

初始化只能执行一次：一旦实例里已存在系统运维账号，初始化接口会拒绝再次执行，不会被人重放来凭空创建管理员。

### 部署模式：自用单墙 vs 多租户

| 模式 | 适合 | 行为 |
| --- | --- | --- |
| **自用单墙（推荐）** | 只运营一个校园墙的个人/小团队 | 隐藏多租户概念：登录后直接进入唯一的墙，没有校园墙选择页。新同学通过墙号机器人私聊注册成普通用户。 |
| **多租户运营平台** | 想像官方服务一样托管多个校园墙、由不同运营者自助开墙 | 暴露校园墙选择页、管理端注册入口和运维面板。和 [app.campux.top](https://app.campux.top) 的形态一致。 |

> 自部署**不推荐**多租户，但完整支持。模式保存在数据库里，日后可由系统运维调整，但建议初始化时就选对。

### 关于邮件（Resend）

多租户模式下运营者通过邮箱验证码自助注册。如果配置了 `RESEND_API_KEY`，验证码通过邮件发送；**未配置时不会报错**，验证码会直接出现在注册接口的响应里（页面上也会显示），方便无邮件的自用部署。单墙模式管理员账号在向导里直接创建，完全不依赖邮件。

## 首次检查

启动后建议依次确认：

1. `/api/health` 返回正常。
2. 首次访问出现「初始化 Campux」向导，并能成功创建第一个管理员账号。
3. 单墙模式：初始化后直接进入校园墙工作台；多租户模式：进入运维面板，且管理端 host 已自动设为当前访问域名。
4. 多租户模式从管理端 host 打开登录页时，能看到面向墙号运营者的邮箱注册入口。
5. 管理页可以添加机器人，并复制 OneBot 连接 URL。
6. 发布管理页能看到发布目标和 cookies 状态。

如果目标是让墙号运营者完全自助开墙（多租户），请继续阅读 [自助开墙流程](/operator/self-service-onboarding)。

想参与 Campux 开发、用热更新和测试账号本地迭代，见[本地开发](/contributing/local-development)。
