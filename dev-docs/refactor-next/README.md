# CampuxNext 重构分析文档

本目录记录从现有 Campux 微服务形态迁移到 CampuxNext TypeScript 全栈单体应用的分析与建议。

阅读顺序：

1. [现状架构分析](./01-current-architecture.md)
2. [目标单体与多租户架构](./02-monolith-multitenant-target.md)
3. [迁移路线与风险清单](./03-migration-plan.md)
4. [CampuxNext 推进 Phase 文档](./04-implementation-phases.md)
5. [运营管理员权限模型](./05-operations-admin-permission-model.md)

本次分析覆盖当前目录下的三个既有项目：

- `Campux/`：Go 后端、Vue 前端、文档与 Docker 编排，是当前核心 Web 应用。
- `CampuxBot/`：Python NoneBot2 机器人端，负责 QQ 私聊注册/重置密码、审核群通知、审核命令、QQ 空间发布。
- `CampuxUtility/`：Python FastAPI + Playwright 文本转图片服务，供 Bot 发布 QQ 空间时把投稿内容渲染成图片。
