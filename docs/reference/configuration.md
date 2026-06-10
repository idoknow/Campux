# 配置项

Campux 通过环境变量配置。可以写在 `.env`，也可以由容器平台注入。

## 应用

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 运行环境，影响 cookie 安全策略和生产检查 |
| `DATABASE_URL` | `postgresql://campux:campux@localhost:5432/campux_next` | PostgreSQL 连接串 |
| `CAMPUX_SERVER_HOST` | `0.0.0.0` | 后端监听地址 |
| `CAMPUX_SERVER_PORT` | `8989` | 后端监听端口 |
| `CAMPUX_WEB_ORIGIN` | `http://localhost:5180` | 前端访问源，影响 CORS 和 cookie |
| `CAMPUX_WEB_DIST_DIR` | `apps/web/dist` | 生产模式静态文件目录 |
| `CAMPUX_SKIP_AUTO_MIGRATE` | `false` | 设置为 `true` 或 `1` 时跳过启动自动迁移 |
| `CAMPUX_ALLOW_SEED` | 空 | `NODE_ENV=production` 下 `bun run db:seed` 默认拒绝执行；设为 `true` 才允许在生产库植入弱密码演示账号 |

## 部署模式与初始化

部署模式不是环境变量，而是在**首次初始化向导**里选择并保存在数据库（`SystemSetting`）中：

- `single`（自用单墙）：隐藏多租户，登录直达唯一校园墙。自部署推荐。
- `multi`（多租户运营平台）：暴露校园墙选择、管理端注册和运维面板，和官方服务一致。

初始化会创建第一个系统运维账号，并把当前访问域名自动设为管理端 host。该流程只能执行一次（实例已有系统运维后接口拒绝重放）。详见[部署与快速开始](/getting-started)。

## 安全

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `CAMPUX_BOT_SESSION_SECRET` | 生产必填 | 加密 Bot session cookies |

生产环境缺少 `CAMPUX_BOT_SESSION_SECRET` 会启动失败。

## 对象存储

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://localhost:9000` | S3-compatible endpoint |
| `S3_REGION` | `auto` | S3 region |
| `S3_BUCKET` | `campux-next` | bucket 名称 |
| `S3_ACCESS_KEY_ID` | `campux` | access key |
| `S3_SECRET_ACCESS_KEY` | `campux-secret` | secret key |
| `S3_PUBLIC_BASE_URL` | `http://localhost:9000/campux-next` | 浏览器可访问的公开前缀 |

`S3_PUBLIC_BASE_URL` 必须从用户浏览器可访问，否则投稿图片和渲染图会裂。

## 渲染

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | 空 | 容器内建议设置为 `/usr/bin/chromium-browser` |
| `CAMPUX_RENDER_CORNER_QQ` | 空 | 渲染图角标头像备用 QQ |

## 匿名遥测

详见[匿名遥测](/admin/telemetry)：上报内容、时机与隐私边界。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CAMPUX_TELEMETRY_DISABLED` | 空 | `true`/`1` 完全关闭匿名遥测 |
| `CAMPUX_TELEMETRY_ENDPOINT` | `https://dash.campux.top` | 中心收集服务地址；非生产环境仅在显式设置时上报 |
| `CAMPUX_TELEMETRY_INSTANCE_NAME` | 空 | 自愿的公开实例标签（≤64 字符） |
| `CAMPUX_BUILD_VERSION` | `dev` | 构建版本号，由 CI 在镜像构建时注入，无需手动设置 |

## 示例

```ini
NODE_ENV=production
DATABASE_URL=postgresql://campux:campux@postgres:5432/campux_next
CAMPUX_SERVER_HOST=0.0.0.0
CAMPUX_SERVER_PORT=8989
CAMPUX_WEB_ORIGIN=https://campux.example.com
CAMPUX_WEB_DIST_DIR=/app/apps/web/dist
CAMPUX_BOT_SESSION_SECRET=replace-with-a-long-random-secret
S3_ENDPOINT=http://minio:9000
S3_REGION=auto
S3_BUCKET=campux-next
S3_ACCESS_KEY_ID=campux
S3_SECRET_ACCESS_KEY=campux-secret
S3_PUBLIC_BASE_URL=https://campux.example.com/assets
```
