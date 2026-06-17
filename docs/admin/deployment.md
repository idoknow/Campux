# 部署与升级

Campux 的生产镜像由 GitHub Actions 构建并推送到 Docker Hub。每个分支会以分支名作为镜像 tag。

::: tip 不想用 Docker？
每个 Release 还提供**自包含的单可执行文件**，下载即跑，只需一个 PostgreSQL。
见 [单文件部署](/admin/standalone-binary)。
:::

## Docker 镜像

镜像组织：

```text
rockchin/campux
```

常见 tag：

| tag | 说明 |
| --- | --- |
| `main` | 主分支镜像 |
| `deploy-prod` | 生产部署分支镜像，来自 `deploy/prod` |
| 其他分支名 | 对应功能分支镜像 |

由于 Docker tag 不支持 `/`，CI 会把分支名中的特殊字符转换为安全字符。

## 自动迁移

应用启动时默认执行：

```bash
prisma migrate deploy
```

如果运维希望手动控制迁移，可以设置：

```ini
CAMPUX_SKIP_AUTO_MIGRATE=true
```

只有在你能保证启动前已经执行过 migration 时，才建议跳过自动迁移。

## 生产环境建议

- 使用外部 PostgreSQL，定期备份。
- 使用对象存储或独立 MinIO，并保证 `S3_PUBLIC_BASE_URL` 可被浏览器访问。
- 使用 HTTPS 反向代理。
- 配置 `CAMPUX_BOT_SESSION_SECRET`。
- 把 `CAMPUX_WEB_ORIGIN` 设置为真实访问域名。
- 定期检查 `/api/health`。

## 升级流程

推荐顺序：

1. 拉取新镜像。
2. 备份 PostgreSQL。
3. 启动新版本。
4. 检查自动迁移日志。
5. 打开 `/api/health`。
6. 登录运维面板，确认租户、用户、机器人和发布目标数量正常。
7. 到发布管理页检查 cookies 状态和最近发布日志。

## 回滚

回滚前先判断是否已经执行了不可逆 migration。如果只是应用逻辑问题，可以回滚到旧镜像；如果 schema 已变化，需要结合数据库备份或手动兼容处理。
