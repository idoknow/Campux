---
title: 单文件部署（Standalone Binary）
---

# 单文件部署（Standalone Binary）

::: tip 适合谁
想最快把 Campux 跑起来、不想装 Docker / Node / Bun 工具链的自托管者。
下载一个对应平台的可执行文件，配好 `DATABASE_URL` 就能启动。
:::

除了 [Docker 镜像](/admin/deployment)，Campux 每个 [Release](https://github.com/idoknow/Campux/releases)
还会发布**自包含的单可执行文件**。它由 `bun build --compile` 产出，**内嵌**了：

- 前端构建产物（`apps/web/dist`）
- 匿名头像 SVG（`svg/`）
- 全部数据库迁移（启动时自动执行，无需 `prisma` CLI）
- Prisma 查询引擎、`argon2` 等原生依赖

运行时**只需要一个可达的 PostgreSQL**，不依赖 Node、Bun、Prisma CLI 或仓库目录。

## 下载

到 [GitHub Releases](https://github.com/idoknow/Campux/releases) 选择对应平台：

| 平台 | 文件名 |
| --- | --- |
| Linux x64 | `campux-linux-x64` |
| Linux arm64 | `campux-linux-arm64` |
| macOS x64（Intel） | `campux-darwin-x64` |
| macOS arm64（Apple Silicon） | `campux-darwin-arm64` |
| Windows x64 | `campux-windows-x64.exe` |

下载后校验完整性（可选）：

```bash
sha256sum -c SHA256SUMS
# 或对单个文件：
sha256sum campux-linux-x64   # 与 campux-linux-x64.sha256 比对
```

## 启动

### Linux / macOS

```bash
chmod +x campux-linux-x64

export DATABASE_URL="postgresql://user:password@127.0.0.1:5432/campux"
# 可选：监听地址 / 端口（默认 0.0.0.0:8989）
export CAMPUX_SERVER_HOST=0.0.0.0
export CAMPUX_SERVER_PORT=8989

./campux-linux-x64
```

### Windows（PowerShell）

```powershell
$env:DATABASE_URL = "postgresql://user:password@127.0.0.1:5432/campux"
$env:CAMPUX_SERVER_PORT = "8989"
.\campux-windows-x64.exe
```

启动时你会先看到内嵌迁移日志，然后是 `Server listening`：

```json
{"scope":"standalone","msg":"campux standalone starting","migrations":46}
{"scope":"migrate","msg":"applying embedded migration","migration":"20260512132711_init"}
{"scope":"standalone","msg":"embedded migrations done","applied":46,"skipped":0}
{"msg":"Server listening at http://0.0.0.0:8989"}
```

确认健康：

```bash
curl http://127.0.0.1:8989/api/health
# {"ok":true,"service":"campux-next","queue":{"running":true,...}}
```

之后用浏览器访问该端口即可进入**初始化向导**，创建第一个系统运维账号。
完整的初始化流程见 [快速开始](/getting-started)。

## 数据库迁移如何工作

单文件形态下没有 `prisma` CLI，二进制改用**内嵌迁移器**：把所有 `migration.sql`
打包进可执行文件，启动时直接连库执行，并写入与 Prisma **完全兼容**的 `_prisma_migrations`
记账表（`checksum = sha256(migration.sql)`，按迁移名去重）。

这意味着：

- 一个**全新空库**会被自动建好全部表结构。
- 一个**已经用 Docker / `prisma migrate deploy` 迁移过的库**，二进制会按迁移名识别为已应用、
  **跳过**，不会重复执行——两种部署形态可以无缝互换。
- 升级到新版二进制时，只会执行新增的迁移。

如需手动控制迁移（例如你想在启动前自行 `prisma migrate deploy`），设置：

```bash
export CAMPUX_SKIP_AUTO_MIGRATE=1
```

## 可选的外部依赖

核心链路（投稿 → 审核 → 发布）开箱即用。以下**雕花功能**依赖系统级组件，缺失时会**自动降级**，
不影响主流程：

| 功能 | 依赖 | 缺失时的行为 |
| --- | --- | --- |
| 上传图片服务端压缩 | 系统 `sharp`/libvips | 跳过压缩，保存原图 |
| 说说配图渲染（图片卡片） | Chromium | 该渲染失败并降级，文字发布不受影响 |
| 视频投稿转码 | `ffmpeg` / `ffprobe` | 对应处理被跳过 |

> 这些原生/外部组件按平台分发，无法稳定地塞进单个可执行文件，因此采用「有则用、无则降级」策略。
> 如果你需要完整的图片压缩 / 配图渲染，推荐用 [Docker 镜像](/admin/deployment)——镜像里已经装好
> Chromium 与字体。

如需让单文件版也启用配图渲染，可自行安装 Chromium 并指定路径：

```bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
```

## 数据落盘位置

二进制每次启动会把内嵌的前端 / SVG 资源解包到临时目录。如果你想固定解包位置（避免每次启动重复解包、
或临时目录被清理），设置：

```bash
export CAMPUX_DATA_DIR=/var/lib/campux
```

## 用 systemd 托管（Linux）

```ini
# /etc/systemd/system/campux.service
[Unit]
Description=Campux
After=network.target postgresql.service

[Service]
Environment=DATABASE_URL=postgresql://user:password@127.0.0.1:5432/campux
Environment=CAMPUX_SERVER_PORT=8989
Environment=CAMPUX_DATA_DIR=/var/lib/campux
ExecStart=/opt/campux/campux-linux-x64
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now campux
sudo journalctl -u campux -f
```

其余生产环境建议（外部 PG 备份、对象存储、HTTPS 反代、`CAMPUX_BOT_SESSION_SECRET` 等）与
[部署与升级](/admin/deployment#生产环境建议) 一致。完整环境变量见 [配置项](/reference/configuration)。

## 自行构建

需要本机构建某个平台的二进制时（注意：原生依赖无法跨平台交叉编译，只能在对应架构的机器上构建）：

```bash
bun install
bun run build:binary            # 为当前主机平台构建到 release/
bun run build:binary --version v1.2.3
```

CI 的多平台矩阵构建见仓库的 `.github/workflows/release.yml`。
