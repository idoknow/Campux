# 迁移路线与风险清单

## 总体策略

建议先做“领域等价重建”，再做“多租户扩展”，最后才逐步增强 UI 和发布平台。不要先追求一次性重写全部体验，否则很容易在 Bot、QZone、OAuth 和后台任务之间拉扯。

迁移目标可以分成四个里程碑：

1. 搭好 TypeScript 单体骨架和数据库模型。
2. 迁移当前单租户核心功能，并跑通投稿到发布。
3. 引入多校园墙管理能力，支持一个实例管理多个校园墙，并明确平铺账户、租户授权、租户内角色和系统运维权限。
4. 停用旧微服务边界，迁移历史数据和运营配置。

## 阶段一：骨架与领域模型

产出：

- `apps/server`：HTTP API、内存队列 worker、Bot runtime 入口。
- `apps/web`：Vite + React 前端应用，使用 shadcn/ui 组件系统。
- `packages/domain`：类型、枚举、权限、状态机。
- `packages/db`：数据库 schema 和迁移。
- `packages/render`：内部文本转图。
- `packages/integrations`：OneBot/QZone/对象存储适配。

优先定义的领域类型：

- Tenant
- User
- TenantMembership
- Post
- PostLog
- PostVerbose
- TenantMetadata
- OAuthApp
- BotAccount
- PublishTarget
- PublishAttempt
- RuntimeJob

本阶段暂时可以只创建一个默认租户，但所有表和 service 方法都按 `tenantId` 设计。

## 阶段二：迁移核心业务

优先顺序：

1. 登录和账号体系：把 QQ uin 迁成全局 `User`。一个用户只有一个账户，通过 `TenantMembership` 授权进入一个或多个校园墙；租户内角色收敛为 `submitter`、`reviewer`、`admin`，系统运维权限作为用户账户级 `system_operator`。
2. 租户 metadata：迁移 `brand`、`banner`、`post_rules`、`services` 等。
3. 投稿：图片上传、投稿创建、个人稿件列表。
4. 审核：后台列表、通过/拒绝、日志。
5. 发布任务：先用内存队列实现 `notifyNewPost`、`publishPost`、`notifyReviewResult`，并为同一租户的多个发布目标生成 fan-out 任务；任务状态通过 PostgreSQL 中的 `publish_attempts` 和投稿状态恢复。
6. QZone 发布：把 `CampuxBot/campux/social/qzone` 迁成 TS integration。
7. 文本转图：把 `CampuxUtility` 迁成内部 `renderPostCard()`。
8. OAuth2：迁移 app 管理、授权码、token、用户信息。

这一阶段可以仍然只暴露一个默认租户前台，保证功能先闭环。

## 阶段三：多租户管理

新增能力：

- 系统运维后台：创建、停用、编辑所有校园墙。
- 登录后的校园墙选择器：仅当账户被授权进入多个校园墙时展示；只有一个校园墙时直接进入；普通用户页面不展示租户切换。
- 租户域名/slug 映射。
- 租户内成员管理：`admin` 可管理自己校园墙的 `submitter`、`reviewer`、`admin` 授权；系统运维可跨校园墙管理。
- 租户级 Bot 配置：多个墙号、审核群、帮助文本、发布延迟、QZone 登录。
- 租户级发布目标配置：同一篇投稿可同步发布到多个 QQ 墙号，并能单独启停、重试和查看失败原因。
- 租户级 S3 对象前缀和数据统计。
- 每个租户独立初始化，而不是全局 `/init` 只创建一个管理员。
- 租户级 UI 主题：品牌色、logo、前台展示文案和状态色。

关键改动：

- 前端路由要带租户上下文，例如 `/t/:slug` 或按域名自动注入。
- API middleware 要解析 tenant context。
- 所有 repository 测试要覆盖 tenant isolation。
- 后台任务必须按 tenant 分片处理，不能全局扫描后混发。

## 阶段四：迁移旧数据

### SQLite 数据迁移

旧 SQLite 表没有 `tenant_id`。迁移时建议：

1. 先在新库创建一个租户，例如 `default` 或学校简称。
2. 导入 `account` 到 `users` 和 `tenant_memberships`。
3. 导入 `metadata` 到 `tenant_metadata`。
4. 导入 `post` 到 `posts`，所有记录写入同一 `tenant_id`。
5. 导入 `post_log`、`post_verbose`、`ban_info`、`oauth_app` 并补 `tenant_id`。
6. 图片对象迁移到租户前缀下，并更新 post.images。

### MongoDB 数据迁移

MongoDB 迁移逻辑相似，但要注意旧 post ID 是代码手动递增，迁入 PostgreSQL 后建议保留旧 `legacy_id`，新主键使用 UUID 或 bigint。

推荐字段策略：

- `id`：新系统内部主键，建议 UUID。
- `display_id`：租户内递增投稿号，用于用户和审核群看到的 `#123`。
- `legacy_id`：旧系统迁移来源 ID，可为空。

这样既能保留旧体验，也避免多租户下不同学校的 `#1` 冲突。

## 当前代码中的迁移风险

| 风险 | 现状 | 建议 |
| --- | --- | --- |
| 全局 UIN | `AccountPO.Uin` 是账号唯一标识和权限载体 | 拆成 `User` 与 `TenantMembership` |
| 全局 metadata | `Metadata.key` 全局唯一 | 改为 `(tenant_id, key)` |
| 全局 post_id | Go/SQLite 自增，Mongo 手动递增 | 改为租户内 `display_id` |
| 全局 service token | Bot 调 API 只靠 `service.token` | 单体内移除，外部兼容 token 租户化 |
| Redis stream 全局 domain | `service.domain`/`campux_domain` 决定 stream 名称 | 新系统暂不使用 Redis；用内存队列调度，并用 PostgreSQL 里的 `tenant_id`、投稿状态和 `publish_attempts` 恢复 |
| Bot cookie 明文缓存 | `qzone_cookies` 存在 Bot data cache | 加密存储到 `bot_sessions` |
| 动态 eval | Bot 的 `post_publish_text` 使用 `eval` | 改安全模板 |
| 发布确认依赖 Hash | 所有 `service.bots` 都置 1 才 published，且配置是全局的 | 改按租户级 `publish_targets` 和 `publish_attempts` 聚合，支持单学校多个 QQ 墙号同步发布 |
| Utility 临时文件 | 独立服务生成临时 jpeg | 迁到内部模块并统一清理 |
| OAuth app 全局 | client_id 不带租户 | app 和授权上下文租户化 |

## 测试优先级

必须优先覆盖：

- 租户隔离：租户 A 不能读写租户 B 的投稿、metadata、OAuth app、封禁记录。
- 权限：平铺账户、租户访问授权、`submitter`、`reviewer`、`admin`、`system_operator` 的边界。
- 投稿状态机：重复审核、取消已审核稿件、发布失败重试。
- 内存队列恢复：进程重启后能从 PostgreSQL 找回发布中、待通知、可重试的任务。
- 多墙号同步发布：同一租户多个发布目标 fan-out、部分失败、单目标重试、聚合状态更新。
- Bot 命令路由：不同审核群映射到不同租户。
- QZone 发布：渲染、上传、发布、记录 verbose、失败日志。
- OAuth2：redirect URI 严格匹配、授权码过期、client secret 校验。

## 建议先做的决策

在正式编码前，建议先定下这些选择：

1. 后端框架：Fastify 或 NestJS 选一个。
2. 前端框架：Vite + React，用户侧移动端优先。
3. ORM：Prisma 还是 Drizzle。
4. 内存队列实现：自研轻量 worker loop，还是选用支持内存 backend 的队列库。
5. 租户访问方式：域名优先、路径优先，还是都支持。
6. Bot 运行方式：内置 OneBot 客户端常驻，还是保留外部 Bot 兼容入口。

我的建议是：

- 包管理器：Bun。
- 后端：Fastify。
- 前端：Vite + React + shadcn/ui，移动端优先，不使用桌面 Sidebar 作为用户侧主导航。
- 数据库：PostgreSQL + Prisma。
- 队列：当前阶段使用内存队列，不引入 Redis；PostgreSQL 持久化发布状态，用扫描补偿处理重启恢复。
- 对象存储：S3 兼容接口，开发环境可用 MinIO。
- 租户识别：域名和路径都支持。
- Bot：新系统内置 Bot runtime，但保留一层外部 webhook/token 兼容空间。
- UI：比当前后台更生动，允许更多色彩、状态色和校园品牌感，但保持审核和运维场景的扫描效率。

## 第一批可落地任务

1. 使用 Bun 建立 CampuxNext monorepo 和基础 lint/test/build。
2. 写出 Prisma schema 初版，包含租户和现有业务模型。
3. 实现 tenant context middleware。
4. 实现 metadata、account、post 的最小 API。
5. 实现默认租户初始化流程。
6. 实现内存队列 worker loop，并实现基于 PostgreSQL 状态的启动恢复扫描。
7. 迁移文本转图为 TS 内部模块。
8. 迁移 OneBot 审核群通知和命令。
9. 写旧 SQLite 到新 PostgreSQL 的一次性迁移脚本。
