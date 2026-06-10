# 遥测中心服务（dash.campux.top）部署手册

面向 Campux 团队：如何把 `apps/dash`（遥测收集器 + 全网看板）部署到 `dash.campux.top`。

## 架构一览

```
自部署实例 (apps/server)                中心服务 (apps/dash)
┌─────────────────────────┐            ┌────────────────────────────┐
│ registerTelemetryReporter│  POST      │ POST /api/v1/report  ← 收数 │
│ 启动后 2min 首报，        │ ────────▶  │   zod 校验 + 限流 + SQLite   │
│ 之后每 6h 心跳（带抖动）   │  HTTPS     │ GET  /api/v1/stats   ← 聚合 │
│ 匿名 UUID 存 SystemSetting│            │ GET  /              ← 看板  │
└─────────────────────────┘            └────────────────────────────┘
```

- 共享报文 schema：`packages/telemetry`（实例端与中心端同源校验，字段集合有测试锁定）
- 存储：单文件 SQLite（`bun:sqlite`，WAL），两张表：`instances`（每实例最新快照）+ `reports`（心跳时间序列，默认保留 400 天）
- 实例端隐私边界与退出方式：见公开文档 `docs/admin/telemetry.md`

## 镜像

CI（`docker-image.yml`）对每个分支推送会构建 `rockchin/campux-dash:<branch>`，与主镜像同一 tag 规则。生产用 `rockchin/campux-dash:deploy-prod`（或固定某次构建的 tag）。

本地构建：

```bash
docker build -f apps/dash/Dockerfile -t rockchin/campux-dash .
```

## 部署步骤

1. 在服务器上放置 `apps/dash/docker-compose.yaml`（或在 Portainer 新建 stack，指向仓库内该文件）。生产环境把 `build:` 段换成 CI 镜像 tag 即可。
2. 可选：在 stack 环境里设置 `CAMPUX_DASH_ACCESS_KEY` —— 设置后看板和 `GET /api/v1/stats` 需要密钥，`POST /api/v1/report` 始终开放（野生实例必须能继续上报）。**不设置则看板公开**，当前决策是公开聚合数据。
3. DNS：`dash.campux.top` → 服务器，建议走 Cloudflare 橙云代理：
   - 自动拿到 TLS；
   - 收集器会读取 `CF-IPCountry` 头，看板实例表的「地区」列才有数据。
4. 反代到容器 `8990` 端口（Caddy 示例）：

   ```
   dash.campux.top {
     reverse_proxy 127.0.0.1:8990
   }
   ```

5. 验收：
   - `curl https://dash.campux.top/api/health` → `{"ok":true,"service":"campux-dash"}`
   - 主站实例（生产镜像默认开启遥测）启动约 2 分钟后，看板应出现第一个实例。

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CAMPUX_DASH_HOST` / `CAMPUX_DASH_PORT` | `0.0.0.0` / `8990` | 监听地址 |
| `CAMPUX_DASH_DB_PATH` | `./data/campux-dash.sqlite` | SQLite 路径（容器内为 `/data/campux-dash.sqlite`，挂卷持久化） |
| `CAMPUX_DASH_ACCESS_KEY` | 空 | 设置后保护看板与 stats API |
| `CAMPUX_DASH_RETENTION_DAYS` | `400` | 原始心跳保留天数（实例快照永久保留） |

## 运维要点

- **备份** = 备份 `/data/campux-dash.sqlite` 一个文件（WAL 模式，`sqlite3 .backup` 或停机拷贝均可）。
- **滥用防护**：报文 zod 强校验 + 64KB body 上限 + 单实例 60s 最小间隔 + 单 IP 120 次/小时。看板暴露的实例 ID 只有前 8 位 —— 完整 UUID 等同上报凭证，不能外泄。
- **统计口径**：看板默认只统计 `environment=production` 的实例；非生产实例单独计数显示在页脚。`GET /api/v1/stats?env=all` 可看全量。
- **本地联调**：`bun run dev:dash` 起收集器，再用 `CAMPUX_TELEMETRY_ENDPOINT=http://localhost:8990 bun run dev:server` 起实例（开发环境必须显式设端点才会上报），约 2 分钟后看板出数。
- **schema 演进**：改报文先改 `packages/telemetry` 并 bump `TELEMETRY_SCHEMA_VERSION`，中心端按需兼容旧版本；同时更新 `docs/admin/telemetry.md` 的字段表（有测试强制对齐字段集合）。
