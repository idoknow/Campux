---
layout: home

hero:
  name: Campux
  text: 开源校园墙运营系统
  tagline: 面向校园墙运营者和系统维护者的一体化投稿、审核、Bot、发布与运维平台。
  image:
    src: /logo.svg
    alt: Campux logo
  actions:
    - theme: brand
      text: 自助开墙
      link: /operator/self-service-onboarding
    - theme: alt
      text: 部署快速开始
      link: /getting-started

features:
  - title: 多墙统一管理
    details: 一个实例管理多个校园墙，账号、成员身份、专属 host 和运维面板统一维护。
  - title: 审核到发布闭环
    details: 网页审核、审核群命令、QZone 发布、失败重试和详细发布日志串成完整链路。
  - title: Bot 原生接入
    details: 支持 OneBot v11 WebSocket，机器人注册、重置密码、审核命令、扫码登录和 cookies 检查。
  - title: 面向自托管
    details: 使用 PostgreSQL、S3/MinIO、Docker Compose 和自动迁移，适合个人或团队部署。
---

![Campux 统计看板](/screenshots/stats-dashboard.png)

Campux 的核心工作台由投稿、稿件审核、租户管理、机器人、发布目标和统计看板组成。下面这些页面截图均来自本地运行环境，展示的是实际产品界面。

![稿件审核工作台](/screenshots/review-board.png)

![系统运维面板](/screenshots/ops-panel.png)

## 文档对象

这套文档只面向两类角色：

- **校园墙运营者**：负责审核、发布、机器人、成员、封禁、公告、投稿规则和运营统计。
- **系统维护者**：负责部署、升级、多租户生命周期、全局账号、系统权限、域名和安全配置。

终端用户只需要知道如何通过机器人注册、登录、投稿和查看自己的稿件状态，不作为这套文档的重点。

## 推荐阅读路径

1. 官方服务开墙：先读 [自助开墙流程](/operator/self-service-onboarding)。
2. 第一次部署：先读 [部署与快速开始](/getting-started)。
3. 接手一个校园墙：读 [运营工作台](/operator/overview) 和 [审核与发布](/operator/review-and-publish)。
4. 接入机器人：读 [机器人管理](/operator/bots) 和 [OneBot 接入](/reference/onebot)。
5. 维护生产环境：读 [运维面板](/admin/overview)、[部署与升级](/admin/deployment) 和 [安全基线](/admin/security)。
