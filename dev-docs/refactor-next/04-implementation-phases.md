# CampuxNext 推进 Phase 文档

本文档用于指导从当前 `refactor/next` 状态继续推进 CampuxNext。它不是长期愿景，而是可执行的阶段拆分、交付标准和依赖顺序。

## 当前基线

已经完成：

- TypeScript monorepo 骨架。
- `apps/web` 切到 Vite + React + shadcn/ui。
- 前端视觉方向回到旧 Campux 风格：移动端投稿流、桌面简易 sidebar、白底、黄色公告、绿色匿名、橙色规则、旧版渐变投稿按钮。
- `AGENTS.md` 写入 UI 和账户权限设计约束。
- Prisma 初始 schema 和 migration 初版。
- 本地开发环境使用 PostgreSQL + MinIO 等现有 infra。
- 后端端口统一为 `8989`。
- 账户体系设计明确为：
  - 一个全局 `User` 账户。
  - 通过 `TenantMembership` 授权进入一个或多个校园墙。
  - 租户内角色：`submitter`、`reviewer`、`admin`。
  - 平台/全局系统角色：`operations_admin`、`system_operator`。
- Phase 1-3 最小闭环已经接入：
  - 真实账号密码登录、session cookie、退出登录。
  - `GET /api/me` 当前用户和 membership。
  - 单 membership 直进校园墙，多 membership 选择校园墙。
  - 当前校园墙 metadata 读取。
  - 图片上传到 S3/MinIO。
  - 创建投稿、查看自己的稿件。
  - seed 测试账号和默认校园墙。
- Phase 4-8 已补齐当前重构版的本地闭环：
  - `reviewer` 可读取待审核列表，并通过/拒绝当前校园墙的稿件。
  - 审核操作写入 `PostLog` 和 `AuditLog`，通过后进入发布 fan-out。
  - `admin` 可管理租户内成员角色、发布目标和校园墙展示配置。
  - 发布队列会为启用发布目标创建 `PublishAttempt`，支持重试、失败原因和聚合投稿状态。
  - Bot 服务端入口支持按 Bot 所属校园墙注册 membership，并支持审核群命令路由。
  - `renderPostCard()` 已迁为 TS 内部安全 SVG 渲染；QZone integration 当前是开发期 mock adapter，会写入外部 ID 和 verbose。
  - 系统运维面板已独立于普通校园墙工作台。
  - `system_operator` 可以查看所有租户生命周期状态、全局用户、Bot/发布目标、队列状态和审计日志。
  - `system_operator` 可以调整租户生命周期：运行中、暂停、归档。
  - `operations_admin` 可以进入运营面板，创建校园墙，并且只能查看/管理自己作为租户管理员加入的校园墙、墙内用户和相关审计/队列信息。
  - 普通用户和租户内 `admin` 不能访问系统运维接口。

## 环境边界

CampuxNext 当前用 `NODE_ENV` 明确区分开发环境和正式环境。服务端如果没有显式设置 `NODE_ENV`，默认按 `production` 处理：

| 环境 | `NODE_ENV` | 账号策略 |
| --- | --- | --- |
| 本地开发 | `development` | 允许使用 seed 生成的测试账号登录，例如 `10000`、`20000`、`30000`、`40000`、`50000`。 |
| 正式环境 | `production` | 禁止测试账号登录。所有用户必须使用真实注册账号。 |

测试账号必须在数据库里标记为 `User.isTestAccount = true`。后端登录接口会以这个字段为准做强校验，非 `development` 环境即使数据库里残留测试账号，也会拒绝登录。前端只在 Vite dev 模式展示测试账号提示和默认填充，正式构建不展示测试账号入口。

当前主要问题：

- 改密、封禁、OAuth、历史迁移仍未进入本轮 Phase 4-8 范围。
- QZone 发布 adapter 当前是开发期 mock，cookie session 已通过 OneBot `get_cookies` 刷新并加密落库；线上发布仍需替换真实 QZone adapter。
- Bot runtime 已接入 OneBot v11 反向 WebSocket，真实协议端连接地址为 `/onebot/v11/ws`。
- 租户开通流程已有运维生命周期管理基础，但还没有完整表单化创建向导。

## 当前 Phase 状态

| Phase | 状态 | 已完成 | 仍需推进 |
| --- | --- | --- | --- |
| Phase 1：真实账户与登录闭环 | 已完成 | 登录、退出、session、`/api/me`、单租户直进、多租户选择、测试账号 dev-only | 真实注册/改密仍归后续 Bot/账号服务 |
| Phase 2：租户上下文与基础配置 | 已完成 | 当前租户上下文、metadata 读取、租户内 admin 修改展示配置 | 域名/路径租户识别仍未做 |
| Phase 3：投稿核心链路 | 已完成 | S3/MinIO 上传、创建投稿、我的稿件、待审核状态 | 取消/撤回 UI 仍可补强 |
| Phase 4：审核员与租户内管理 | 已完成 | 待审核列表、通过/拒绝、日志、成员角色、发布目标、租户展示配置、角色化前端入口 | 封禁/拒绝原因库可后续增强 |
| Phase 5：发布队列与多墙号发布 | 已完成 | 内存队列、`PublishTarget`、`PublishAttempt`、fan-out、重试、聚合状态、重启恢复扫描、失败原因展示 | 真实平台失败分类可后续细化 |
| Phase 6：Bot 注册、审核群与命令路由 | 已完成 | OneBot v11 反向 WS、私聊注册、私聊重置密码、审核群通知、`#通过`、`#拒绝`、租户隔离校验 | 更多群内辅助命令可后续补强 |
| Phase 7：QZone 发布与文本转图迁移 | 已完成 | TS `renderPostCard()`、安全 XML 转义模板、QZone mock adapter、verbose 写入、发布日志、QZone cookies 协议刷新、Bot session 加密落库 | 真实 QZone 线上发布 adapter 待凭据接入 |
| Phase 8：系统与运营后台 | 已完成 | 独立入口、租户生命周期、全局用户/membership、Bot/发布目标、队列状态、审计日志、运营管理员范围化管理 | 表单化租户开通向导可继续打磨 |
| Phase 9：历史数据迁移与兼容 | 未开始 | 无 | SQLite/Mongo/S3/OAuth 迁移脚本 |

## Phase 1：真实账户与登录闭环

目标：把“点击登录直接进入”替换成真实账户流程，建立后续所有业务的权限基础。

范围：

- 用户登录 API。
- 密码校验和 session/cookie。
- 当前用户 API，例如 `GET /api/me`。
- 根据用户 membership 决定登录后落点。
- 前端登录页。
- 多校园墙选择页。
- 无授权校园墙状态页。
- 退出登录 API 和前端退出行为。

核心规则：

1. 一个用户只有一个全局账户。
2. 用户不能默认进入所有校园墙。
3. 用户只有被授权了 `TenantMembership` 才能进入对应校园墙。
4. 一个 membership 时直接进入该校园墙。
5. 多个 membership 时先选择校园墙。
6. 有 `system_operator` 时额外展示系统运维入口。
7. 有 `operations_admin` 时额外展示运营管理入口。
8. 系统运维/运营管理入口与普通校园墙工作台分离，不能作为某个租户里的普通 tab。

建议 API：

| API | 说明 |
| --- | --- |
| `POST /api/auth/login` | 账号密码登录 |
| `POST /api/auth/logout` | 清理 session |
| `GET /api/me` | 当前用户、系统角色、可进入的校园墙列表 |
| `POST /api/session/tenant` | 选择当前校园墙 |

验收标准：

- 退出后刷新不会回到投稿页。
- 未登录用户访问投稿页会进入登录页。
- 只有一个 membership 的用户登录后直接进入对应校园墙。
- 多 membership 用户登录后进入校园墙选择页。
- 无 membership 用户看到明确的无授权提示。
- 前端不再用 localStorage 假登录作为主要认证依据。

## Phase 2：租户上下文与基础配置

目标：让每个请求都有明确校园墙上下文，并让前台页面读取真实配置。

范围：

- Tenant context middleware。
- 通过域名、路径或 session 解析当前校园墙。
- `TenantMetadata` repository。
- 真实读取品牌名、公告、投稿规则、服务入口。
- 前端从 API 获取当前校园墙配置。
- seed 或后续租户开通流程初始化默认校园墙配置。

建议 API：

| API | 说明 |
| --- | --- |
| `GET /api/context` | 当前校园墙、当前用户、当前 membership |
| `GET /api/tenant/metadata` | 当前校园墙公开配置 |
| `PATCH /api/admin/tenant/metadata` | 租户内 admin 修改允许开放的配置 |

验收标准：

- 普通用户 UI 不出现 raw `tenantId`、slug 或“租户”概念。
- 投稿页标题、公告、规则来自当前校园墙配置。
- `admin` 只能修改自己校园墙的配置。
- `reviewer` 和 `submitter` 调配置修改 API 会被拒绝。
- `system_operator` 不直接在运维面板里修改品牌名、公告、主题色等租户展示配置；这些配置归属租户内管理页。

## Phase 3：投稿核心链路

目标：跑通用户投稿、图片上传、查看自己的稿件。

范围：

- S3/MinIO 图片上传。
- 投稿创建 API。
- 投稿文本、图片、匿名字段落库。
- 租户内 `displayId` 生成。
- 当前用户稿件列表。
- 投稿取消或撤回。
- 投稿状态展示。

建议 API：

| API | 说明 |
| --- | --- |
| `POST /api/uploads/post-images` | 上传投稿图片 |
| `POST /api/posts` | 创建投稿 |
| `GET /api/posts/mine` | 查看自己的稿件 |
| `POST /api/posts/:id/cancel` | 取消自己的待审核稿件 |

验收标准：

- `submitter` 可以创建投稿。
- 投稿必须写入当前校园墙 `tenantId`。
- 用户不能看到其他人的稿件。
- 用户不能跨校园墙读取或取消稿件。
- 图片对象 key 包含校园墙和投稿前缀。
- 前端投稿成功后能看到待审核状态。

## Phase 4：审核员与租户内管理

目标：让 `reviewer` 和 `admin` 有真实可用的审核工作流。

范围：

- 待审核列表。
- 审核通过、拒绝、备注。
- PostLog。
- 基础封禁或拒绝原因记录。
- 租户内成员管理。
- 租户内展示配置管理：校园墙名称、slug、主题色、品牌名、公告、投稿规则、服务入口。
- 前端根据角色显示不同页面：
  - `submitter`：普通用户，投稿和自己的稿件。
  - `reviewer`：审核页。
  - `admin`：审核页 + 校园墙设置 + 成员/发布目标配置。

建议 API：

| API | 说明 |
| --- | --- |
| `GET /api/review/posts` | 待审核列表 |
| `POST /api/review/posts/:id/approve` | 通过投稿 |
| `POST /api/review/posts/:id/reject` | 拒绝投稿 |
| `GET /api/admin/members` | 租户内成员列表 |
| `PATCH /api/admin/members/:id` | 调整租户内角色 |
| `PATCH /api/admin/tenant/metadata` | 修改当前校园墙展示配置 |

验收标准：

- `reviewer` 能审核，但不能修改校园墙配置。
- `admin` 能审核并修改自己校园墙允许开放的配置，例如名称、slug、主题色、公告、投稿规则、服务入口。
- `submitter` 看不到审核入口。
- 所有审核 API 都校验当前校园墙。
- 审核操作写入日志。

## Phase 5：发布队列与多墙号发布

目标：审核通过后进入发布流程，并能支持一个校园墙多个 QQ 墙号同步发布。

范围：

- 内存队列 worker loop。
- `PublishTarget` 管理。
- `PublishAttempt` 记录。
- 发布任务恢复扫描。
- 单目标失败重试。
- 聚合投稿发布状态。
- 失败原因展示。

建议 API：

| API | 说明 |
| --- | --- |
| `GET /api/admin/publish-targets` | 当前校园墙发布目标 |
| `PATCH /api/admin/publish-targets/:id` | 启停或修改发布目标 |
| `POST /api/admin/publish-attempts/:id/retry` | 重试单个发布目标 |
| `GET /api/admin/posts/:id/publish-attempts` | 查看发布详情 |

验收标准：

- 审核通过后为所有启用目标生成 fan-out 发布任务。
- 每个目标有独立 attempt、状态、错误原因、重试次数。
- required 目标全部成功后投稿进入 `published`。
- 部分失败时后台能看到具体墙号失败原因。
- 服务重启后能从 PostgreSQL 恢复未完成任务。

## Phase 6：Bot 注册、审核群与命令路由

目标：把旧 Bot 能力迁入新系统，让 Bot 成为授权和审核入口。

范围：

- Bot runtime 基础框架。
- QQ 私聊注册和重置密码。
- 注册时按 Bot/命令上下文授权对应校园墙 membership。
- 审核群通知。
- 审核命令。
- QZone cookies 刷新命令：审核群内 `#登录` 或 `#刷新qzone cookies`，通过 OneBot `get_cookies(domain='user.qzone.qq.com')` 获取。
- 群号、Bot 账号、校园墙的绑定关系。

验收标准：

- 用户通过某校园墙 Bot 注册后，只获得该校园墙访问权限。
- 同一个用户可通过不同校园墙 Bot 获得多个 membership。
- 审核群命令只能作用于绑定校园墙的稿件。
- 不同校园墙的审核群互不串数据。
- matcha OneBot mock 客户端可以完成私聊注册、重置密码、审核群刷新 cookies、通过、拒绝的端到端验证。

## Phase 7：QZone 发布与文本转图迁移

目标：替代旧 `CampuxBot` + `CampuxUtility` 发布链路。

范围：

- QZone 登录状态和 cookies 加密存储。
- QZone 发布 integration。
- 内部 `renderPostCard()` 文本转图。
- 安全模板引擎替代动态 `eval`。
- 发布结果 verbose 记录。

验收标准：

- 投稿内容可以渲染成发布图片。
- QZone 发布成功后写入 `PublishAttempt` 和投稿日志。
- 发布失败记录明确错误。
- 模板不能执行任意代码。
- 临时文件有统一清理。

## Phase 8：系统运维后台

目标：让 `system_operator` 管理整个实例，而不是混在普通校园墙 UI 里。

范围：

- 独立运维面板入口，不作为普通校园墙 tab。
- 租户生命周期管理：运行中、暂停、归档。
- 全局租户运行概览和统计。
- 查看所有用户和 membership。
- 跨校园墙查看 Bot、发布目标、域名绑定和运行状态。
- 系统运行状态和队列状态。
- 审计日志。
- 租户开通流程。

明确不属于系统运维面板的内容：

- 校园墙名称、slug、主题色、前台品牌名、公告、投稿规则、服务入口。
- 这些属于租户自身运营配置，应由该租户的 `admin` 在租户内管理页维护。

验收标准：

- 只有 `system_operator` 能进入运维面板。
- 运维面板与普通校园墙页面入口分离。
- 系统运维只能在运维面板修改生命周期和系统级状态；进入租户内配置视角时必须明确切换上下文。
- 普通 `admin` 不能跨校园墙管理。

## Phase 9：历史数据迁移与兼容

目标：把旧系统数据迁入新结构，并保留必要兼容入口。

范围：

- SQLite 到 PostgreSQL 迁移脚本。
- MongoDB 历史投稿迁移。
- 图片对象迁移到 S3 前缀。
- OAuth app 迁移。
- 旧 `/v1` 兼容层，必要时只支持单租户默认映射。

验收标准：

- 旧账号迁成全局 `User` + 对应 `TenantMembership`。
- 旧投稿保留用户可见编号。
- 旧图片可正常访问。
- 旧 OAuth app 不跨校园墙泄漏。
- 迁移脚本可重复 dry-run 并输出差异报告。

## 推荐推进顺序

已完成或基本完成：

1. Phase 1：真实登录和账户上下文。
2. Phase 2：当前校园墙配置读取。
3. Phase 3：真实投稿和图片上传。

短期下一步：

4. Phase 4：审核工作流、租户内成员管理、发布目标管理。
5. Phase 8：补齐系统运维的全局用户、membership、队列状态和审计日志。

中期再做：

6. Phase 5：发布队列。
7. Phase 6：Bot 注册和审核群。
8. Phase 7：QZone 发布和文本转图。

最后做：

9. Phase 9：历史数据迁移和兼容。

## 每个 Phase 的通用完成标准

- 有真实 API，不只是假数据 UI。
- 权限边界有测试或最小验证。
- 租户隔离明确，不允许裸查全表。
- 用户侧不暴露 raw tenant 概念。
- 前端移动端和桌面端都能完成核心操作。
- `bun run typecheck` 通过。
- 涉及前端页面时，`bun --cwd apps/web build` 通过。
