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
