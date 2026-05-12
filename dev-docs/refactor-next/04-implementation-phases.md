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
  - 全局系统角色：`system_operator`。
- Phase 1-3 最小闭环已经接入：
  - 真实账号密码登录、session cookie、退出登录。
  - `GET /api/me` 当前用户和 membership。
  - 单 membership 直进校园墙，多 membership 选择校园墙。
  - 当前校园墙 metadata 读取。
  - 图片上传到 S3/MinIO。
  - 创建投稿、查看自己的稿件。
  - seed 测试账号和默认校园墙。

当前主要问题：

- 登录和投稿已经是最小真实链路，但还没有旧系统完整功能，例如改密、Bot 注册、封禁、OAuth。
- 审核、配置、服务页仍然是 UI 骨架或只读入口，Phase 4 才会接入真实审核和租户内管理。
- 发布队列、Bot 注册授权、QZone 发布和文本转图还没有接入。
- 系统运维面板还只是权限模型和入口设计，没有真实后台页面。

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
- 系统运维或 seed 初始化默认校园墙。

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
- `system_operator` 可以跨校园墙查看和修改配置。

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
- 前端根据角色显示不同页面：
  - `submitter`：投稿和自己的稿件。
  - `reviewer`：审核页。
  - `admin`：审核页 + 校园墙设置。

建议 API：

| API | 说明 |
| --- | --- |
| `GET /api/review/posts` | 待审核列表 |
| `POST /api/review/posts/:id/approve` | 通过投稿 |
| `POST /api/review/posts/:id/reject` | 拒绝投稿 |
| `GET /api/admin/members` | 租户内成员列表 |
| `PATCH /api/admin/members/:id` | 调整租户内角色 |

验收标准：

- `reviewer` 能审核，但不能修改校园墙配置。
- `admin` 能审核并修改自己校园墙允许开放的配置。
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
- 群号、Bot 账号、校园墙的绑定关系。

验收标准：

- 用户通过某校园墙 Bot 注册后，只获得该校园墙访问权限。
- 同一个用户可通过不同校园墙 Bot 获得多个 membership。
- 审核群命令只能作用于绑定校园墙的稿件。
- 不同校园墙的审核群互不串数据。

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

- 运维面板入口。
- 创建、停用、编辑校园墙。
- 查看所有用户和 membership。
- 跨校园墙配置 Bot、发布目标、域名/slug。
- 系统运行状态和队列状态。
- 审计日志。

验收标准：

- 只有 `system_operator` 能进入运维面板。
- 运维面板与普通校园墙页面入口分离。
- 系统运维能进入任意校园墙配置视角。
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

短期先做：

1. Phase 1：真实登录和账户上下文。
2. Phase 2：当前校园墙配置读取。
3. Phase 3：真实投稿和图片上传。
4. Phase 4：审核工作流。

中期再做：

5. Phase 5：发布队列。
6. Phase 6：Bot 注册和审核群。
7. Phase 7：QZone 发布和文本转图。

最后做：

8. Phase 8：系统运维后台。
9. Phase 9：历史数据迁移和兼容。

## 每个 Phase 的通用完成标准

- 有真实 API，不只是假数据 UI。
- 权限边界有测试或最小验证。
- 租户隔离明确，不允许裸查全表。
- 用户侧不暴露 raw tenant 概念。
- 前端移动端和桌面端都能完成核心操作。
- `bun run typecheck` 通过。
- 涉及前端页面时，`bun --cwd apps/web build` 通过。
