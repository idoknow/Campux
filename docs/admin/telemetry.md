# 匿名遥测

Campux 自托管实例默认会向官方中心服务 `dash.campux.top` 上报**匿名聚合统计**，帮助我们了解版本分布、活跃实例规模和整体使用量，以决定维护和兼容性优先级。汇总后的全网数据在 [dash.campux.top](https://dash.campux.top) 公开可见。

设计原则：**匿名、聚合、可退出**。上报内容不包含任何用户内容或身份信息，一个环境变量即可完全关闭。

## 上报了什么

每条报告只包含以下字段（wire schema 固定在 `packages/telemetry`，有单元测试锁定字段集合，新增字段必须先更新本页）：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `instanceId` | `0b8e9938-…` | 首次上报时随机生成的 UUID，存于数据库 `SystemSetting`。与域名、硬件、运营者均无关；删除该行即换新身份 |
| `instanceName` | `gz-wall` | **默认不发送**。仅当你主动设置 `CAMPUX_TELEMETRY_INSTANCE_NAME` 时附带，会显示在公开看板上 |
| `version` | `main-ab12cd3` | 镜像构建版本（CI 注入），本地运行为 `dev` |
| `environment` | `production` | `NODE_ENV` |
| `deployMode` | `single` | 部署模式（自用单墙 / 多租户） |
| `setupCompleted` | `true` | 是否完成初始化向导 |
| `uptimeSeconds` | `86400` | 进程运行时长 |
| `runtime` | — | Bun 版本、操作系统平台、CPU 架构、是否在 Docker 内 |
| `counts` | — | 聚合计数：活跃校园墙数、用户数、成员关系数、稿件总数、近 24h 稿件数、启用的 Bot 数、启用的发布目标数 |
| `features` | — | 是否配置了邮件发送、启用 AI 的墙数 |

**永远不会上报**：域名/IP（服务端不主动采集；中心端仅在经过 CDN 时记录国家代码）、用户名、邮箱、QQ 号、墙名、slug、稿件内容、任何数据库行级数据。

## 何时上报

- 启动约 2 分钟后首次上报，此后每 2 小时一次（带随机抖动）
- 上报失败静默重试（debug 级日志），不影响实例任何功能
- `NODE_ENV` 非 `production` 时**默认不上报**（除非显式设置了 `CAMPUX_TELEMETRY_ENDPOINT`，用于本地调试管线）

## 如何退出

在 `.env` 或容器环境中设置：

```ini
CAMPUX_TELEMETRY_DISABLED=true
```

重启后日志会输出 `anonymous telemetry disabled by CAMPUX_TELEMETRY_DISABLED`。

## 相关配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CAMPUX_TELEMETRY_DISABLED` | 空 | `true`/`1` 完全关闭遥测 |
| `CAMPUX_TELEMETRY_ENDPOINT` | `https://dash.campux.top` | 中心收集服务地址；可指向自建收集器 |
| `CAMPUX_TELEMETRY_INSTANCE_NAME` | 空 | 自愿的公开实例标签（≤64 字符），显示在全网看板 |

## 自建收集器

收集器和看板本身也是开源的（`apps/dash`），fork 或私有部署时可以把全部实例指向自己的收集端：

```ini
CAMPUX_TELEMETRY_ENDPOINT=https://dash.example.com
```

部署方式见仓库内 `apps/dash/docker-compose.yaml` 与 `dev-docs/telemetry-dash.md`。

## 验证实际发送的内容

把端点指向本地即可观察完整报文：

```bash
# 终端 1：起一个本地收集器
bun run dev:dash

# 终端 2：让实例指向它（开发环境必须显式设置端点才会上报）
CAMPUX_TELEMETRY_ENDPOINT=http://localhost:8990 bun run dev:server
```

随后访问 `http://localhost:8990` 即可在看板上看到这台实例，或直接 `curl http://localhost:8990/api/v1/stats` 查看原始数据。
