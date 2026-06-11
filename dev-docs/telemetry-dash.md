# 遥测中心服务（dash.campux.top）部署手册

面向 Campux 团队：如何把 `apps/dash`（遥测收集器 + 全网看板）部署到 `dash.campux.top`。

## 架构一览

```
自部署实例 (apps/server)                中心服务 (apps/dash)
┌─────────────────────────┐            ┌────────────────────────────┐
│ registerTelemetryReporter│  POST      │ POST /api/v1/report  ← 收数 │
│ 启动后 2min 首报，        │ ────────▶  │   zod 校验 + 限流 + SQLite   │
│ 之后每 2h 心跳（带抖动）   │  HTTPS     │ GET  /api/v1/stats   ← 聚合 │
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
   - 收集器读取 `CF-IPCountry`（国家）与 `CF-Region-Code`（省/州级行政区）头，看板的「省份」列与「省份分布」面板才有数据。
   - `CF-Region-Code` 需要在 Cloudflare 该域名上启用 **Managed Transforms → Add visitor location headers**（默认不发），否则只有国家、无省份。Campux 为中国大陆产品，省份码（如 `GD`→广东、`11`→北京）在中心端映射为中文省名。
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
| `CAMPUX_DASH_ADMIN_KEY` | 空 | 设置后开放**运维标记**写接口（给实例打标签/备注）；**不设置则标记接口直接 404**，看板只读。与读密钥相互独立 |
| `CAMPUX_DASH_RETENTION_DAYS` | `400` | 原始心跳保留天数（实例快照永久保留） |

## 运维标记（给各实例打标签）

实例上报是**匿名**的——看板只暴露随机 UUID 的前 8 位，不知道每台实例对应哪所学校。运维标记让你（中心服务的维护者）在中心侧给实例加一个**人类可读的标签 + 备注**（例如「广州大学城 / 官方运营」「测试墙」），只存在中心库、不下发、不影响实例端隐私。

- **存储**：独立的 `instance_tags` 表（`instance_id` 主键 + `label`/`note`/`updated_at`）。**故意不放在 `instances` 行上**——心跳上报会整行重写 `instances`，标记若混在里面会被覆盖。
- **鉴权**：写接口由 `CAMPUX_DASH_ADMIN_KEY` 保护，**与看板读密钥 `CAMPUX_DASH_ACCESS_KEY` 完全独立**（看板可以公开只读，但写标记必须有运维密钥）。密钥只从 `X-Admin-Key` 头或 `Authorization: Bearer` 取，不走 query string，避免落进 CDN/反代访问日志。
- **寻址**：用看板上显示的 8 位短 ID（也接受完整 UUID）。前缀唯一即可；不唯一返回 `409`，不存在返回 `404`。

接口：

```bash
# 打标记（label 必填，note 可选；label/note 各自上限 80/280 字）
curl -X PUT https://dash.campux.top/api/v1/instances/<短ID>/tag \
  -H 'X-Admin-Key: <CAMPUX_DASH_ADMIN_KEY>' -H 'content-type: application/json' \
  -d '{"label":"广州大学城","note":"官方运营实例"}'

# 清除标记（label 与 note 都留空亦可，等价于删除）
curl -X DELETE https://dash.campux.top/api/v1/instances/<短ID>/tag \
  -H 'X-Admin-Key: <CAMPUX_DASH_ADMIN_KEY>'
```

看板上的操作：实例表新增「标记」列。设置了运维密钥后，点表格上方「输入运维密钥」存入浏览器（localStorage），即可点任意实例行的标记（或「+ 标记」）就地编辑。标记会作为橙色标签显示，备注作为灰色副文本。

## 运维要点

- **备份** = 备份 `/data/campux-dash.sqlite` 一个文件（WAL 模式，`sqlite3 .backup` 或停机拷贝均可）。
- **滥用防护**：报文 zod 强校验 + 64KB body 上限 + 单实例 60s 最小间隔 + 单 IP 120 次/小时。看板暴露的实例 ID 只有前 8 位 —— 完整 UUID 等同上报凭证，不能外泄。
- **统计口径**：看板默认只统计 `environment=production` 的实例；非生产实例单独计数显示在页脚。`GET /api/v1/stats?env=all` 可看全量。
- **本地联调**：`bun run dev:dash` 起收集器，再用 `CAMPUX_TELEMETRY_ENDPOINT=http://localhost:8990 bun run dev:server` 起实例（开发环境必须显式设端点才会上报），约 2 分钟后看板出数。
- **schema 演进**：改报文先改 `packages/telemetry` 并 bump `TELEMETRY_SCHEMA_VERSION`，中心端按需兼容旧版本；同时更新 `docs/admin/telemetry.md` 的字段表（有测试强制对齐字段集合）。
