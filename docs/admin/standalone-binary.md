---
title: 单文件部署（Standalone Binary）
---

# 单文件部署（Standalone Binary）

::: tip 适合谁
想最快把 Campux 跑起来、不想装 Docker / Node / Bun、也不想单独部署 PostgreSQL 和 MinIO 的自托管者。
下载一个对应平台的可执行文件，**直接运行即可**——默认用内置 SQLite + 本地文件系统存储，零外部依赖。
:::

除了 [Docker 镜像](/admin/deployment)，Campux 每个 [Release](https://github.com/idoknow/Campux/releases)
还会发布**自包含的单可执行文件**。它由 `bun build --compile` 产出，**内嵌**了：

- 前端构建产物（`apps/web/dist`）
- 匿名头像 SVG（`svg/`）
- 数据库建库脚本 / 迁移（启动时自动执行，无需 `prisma` CLI）
- Prisma 查询引擎、`argon2` 等原生依赖

**默认零依赖**：不配任何环境变量直接运行，就会在工作目录下创建 `./data/`，用其中的
**SQLite 数据库**（`./data/campux.db`）和**本地文件存储**（`./data/uploads/`）跑起来——
不需要 PostgreSQL，也不需要 MinIO / S3。需要时仍可切换到外部 PostgreSQL + S3（见下文）。

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

### 最简：零配置直接运行（SQLite + 本地存储）

```bash
chmod +x campux-linux-x64
./campux-linux-x64
```

就这样。二进制会在**当前工作目录**下创建 `./data/`，里面包含：

- `data/campux.db` —— SQLite 数据库（自动建表）
- `data/uploads/` —— 投稿图片的本地存储
- `data/assets/`、`data/engine/` —— 运行时解包的前端 / SVG / Prisma 引擎

想把数据放到固定位置（推荐生产用），设置 `CAMPUX_DATA_DIR`：

```bash
export CAMPUX_DATA_DIR=/var/lib/campux
export CAMPUX_SERVER_PORT=8989       # 可选，默认 0.0.0.0:8989
./campux-linux-x64
```

> 生产环境务必设置 `CAMPUX_BOT_SESSION_SECRET`（用于加密存储的机器人会话 cookie），
> 见 [配置项](/reference/configuration)。

### Windows（PowerShell）

```powershell
$env:CAMPUX_DATA_DIR = "C:\campux\data"
$env:CAMPUX_SERVER_PORT = "8989"
.\campux-windows-x64.exe
```

### 进阶：使用外部 PostgreSQL + S3 / MinIO

如果你已经有 PostgreSQL 和对象存储（或想用它们以获得更强的并发 / 备份能力），
只要设置 `DATABASE_URL` 指向 PostgreSQL，二进制就会自动切换到 PG 形态；
再设置 `CAMPUX_STORAGE_DRIVER=s3` 与 `S3_*` 即可启用对象存储：

```bash
export DATABASE_URL="postgresql://user:***@127.0.0.1:5432/campux"
export CAMPUX_STORAGE_DRIVER=s3
export S3_ENDPOINT="http://127.0.0.1:9000"
export S3_BUCKET=campux-next
export S3_ACCESS_KEY_ID=campux
export S3_SECRET_ACCESS_KEY=***
./campux-linux-x64
```

数据库形态由 `DATABASE_URL` 的协议自动判定：

| `DATABASE_URL` | 数据库形态 | 默认存储 |
| --- | --- | --- |
| 未设置 / `file:...` / `*.db` | **SQLite**（单文件） | 本地文件系统 |
| `postgresql://...` / `postgres://...` | **PostgreSQL** | S3 / MinIO |

存储后端默认跟随数据库形态，也可用 `CAMPUX_STORAGE_DRIVER=local|s3` 单独覆盖
（例如 PostgreSQL + 本地存储，或 SQLite + S3）。完整变量见 [配置项](/reference/configuration)。

启动时你会先看到内嵌建库 / 迁移日志，然后是 `Server listening`：

```json
{"scope":"standalone","msg":"campux standalone starting","dbProvider":"sqlite","dataDir":"/var/lib/campux"}
{"scope":"migrate","msg":"applying sqlite baseline schema","migration":"0_sqlite_baseline"}
{"scope":"standalone","msg":"sqlite baseline done","applied":1,"skipped":0}
{"msg":"Server listening at http://0.0.0.0:8989"}
```

（若用外部 PostgreSQL，会看到 `dbProvider":"postgresql"` 与逐条迁移日志。）

确认健康：

```bash
curl http://127.0.0.1:8989/api/health
# {"ok":true,"service":"campux-next","queue":{"running":true,...}}
```

之后用浏览器访问该端口即可进入**初始化向导**，创建第一个系统运维账号。
完整的初始化流程见 [快速开始](/getting-started)。

## 数据库：SQLite（默认）与 PostgreSQL

单文件形态下没有 `prisma` CLI，二进制改用**内嵌建库 / 迁移器**：

- **SQLite（默认）**：内嵌一份 baseline 建库脚本，启动时用 `bun:sqlite` 一次性建好全部表，
  并写入与 Prisma 兼容的 `_prisma_migrations` 记账（按名去重，幂等）。适合「一台机、单进程、
  全新部署」——绝大多数自托管场景。
- **PostgreSQL（可选）**：设置 `DATABASE_URL=postgresql://...` 即切换。二进制把全部
  `migration.sql` 内嵌，启动时直接连库执行，写入与 `prisma migrate deploy` **完全兼容**的
  `_prisma_migrations`（`checksum = sha256(migration.sql)`，按迁移名去重）。

这意味着：

- 一个**全新空库**（SQLite 文件或空 PG 库）会被自动建好全部表结构。
- PG 形态下，一个**已经用 Docker / `prisma migrate deploy` 迁移过的库**，二进制会按迁移名
  识别为已应用、**跳过**——Docker 与单文件两种部署可无缝互换同一个 PG 库。
- 升级到新版二进制时，PG 只执行新增迁移；SQLite baseline 已存在则跳过。

> SQLite 与 PostgreSQL 用的是**同一套数据模型、同一份业务代码**——二进制内置了两套 Prisma
> client，运行时按 `DATABASE_URL` 协议选择，少数 SQL 方言差异（大小写不敏感匹配、批量去重、
> 建议锁）已在代码层自动适配。

如需手动控制迁移（例如你想在启动前自行 `prisma migrate deploy`），设置：

```bash
export CAMPUX_SKIP_AUTO_MIGRATE=1
```

## 存储：本地文件系统（默认）与 S3 / MinIO

投稿图片默认存到本地文件系统（`<dataDir>/uploads/`，可用 `CAMPUX_STORAGE_LOCAL_DIR` 覆盖），
零外部依赖。所有图片读取都走应用自身的 `/api/uploads/post-image` 代理，不暴露文件系统路径。

需要对象存储时（多实例共享、CDN、独立备份），设置 `CAMPUX_STORAGE_DRIVER=s3` 并配 `S3_*`
（端点、桶、密钥）即可切换到 S3 / MinIO，行为与 Docker 形态一致。

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

二进制启动时会在数据目录下创建/使用：SQLite 库（`campux.db`）、本地存储（`uploads/`）、
解包的前端 / SVG 资源（`assets/`）、解包的 Prisma 引擎（`engine/`）。数据目录默认是启动时
工作目录下的 `./data`，**强烈建议**用 `CAMPUX_DATA_DIR` 固定到一个持久路径：

```bash
export CAMPUX_DATA_DIR=/var/lib/campux
```

> 备份很简单：SQLite + 本地存储形态下，**整个 `CAMPUX_DATA_DIR` 目录就是全部状态**——
> 停服后打包该目录即可完整备份/迁移。

## 用 systemd 托管（Linux）

最简形态（SQLite + 本地存储，零外部依赖）：

```ini
# /etc/systemd/system/campux.service
[Unit]
Description=Campux
After=network.target

[Service]
Environment=CAMPUX_SERVER_PORT=8989
Environment=CAMPUX_DATA_DIR=/var/lib/campux
Environment=CAMPUX_BOT_SESSION_SECRET=请改成一段随机字符串
ExecStart=/opt/campux/campux-linux-x64
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> 若改用外部 PostgreSQL，加上 `After=postgresql.service` 与
> `Environment=DATABASE_URL=postgresql://...`（以及需要的话 `CAMPUX_STORAGE_DRIVER=s3` + `S3_*`）。

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
