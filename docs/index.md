---
layout: home

hero:
  name: Campux
  text: 开源校园墙运营系统
  tagline: 面向校园墙运营管理员的投稿、审核、Bot、发布与运维一体化平台。
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

## 核心功能

| 功能 | 简介 | 预览 |
| --- | --- | --- |
| **网页、私聊双重投稿渠道** | 网页端和 QQ 私聊墙号机器人均可投稿，两个入口统一进入同一条审核流程。 | ![网页与私聊双投稿渠道](/screenshots/features/submission-channels.png) |
| **自动发表到空间，支持单条、多条稿件发布** | 稿件通过审核后自动发表到 QQ 空间，既支持单条即时发布，也支持多条稿件合并为一条说说发布；失败可重试，发布日志可追溯。 | ![自动发表到 QQ 空间](/screenshots/features/auto-publish.png) |
| **自动获取登录信息，省心快捷** | 协议自动获取与扫码登录两种方式维护 QZone 登录态，定时检测、失效自动刷新，无需手动抓取 cookies。 | ![自动获取登录信息](/screenshots/features/auto-login.png) |
| **投稿量、访客量统计图表** | 统计看板以图表展示投稿量、空间访客量等运营数据，支持多时间范围切换，活跃度与发布质量一目了然。 | ![投稿量与访客量统计图表](/screenshots/features/stats-charts.png) |
| **评论同步展示、定时通知投稿人** | QQ 空间评论自动同步到站内稿件页展示；投稿人关注自己的稿件后，会定时收到新评论摘要的私聊通知。 | ![评论同步展示与定时通知](/screenshots/features/comment-sync.png) |

## 产品界面

Campux 的核心工作台由投稿、稿件审核、租户管理、机器人、发布目标和统计看板组成。下面这些页面截图均来自本地运行环境，展示的是实际产品界面。

![Campux 统计看板](/screenshots/stats-dashboard.png)

![稿件审核工作台](/screenshots/review-board.png)

![系统运维面板](/screenshots/ops-panel.png)

## 文档对象

这套文档主要面向**校园墙运营管理员**：自助开墙、审核发布、机器人、成员、封禁、公告、投稿规则和运营统计。

系统维护者（部署、多租户生命周期、全局账号、域名、安全）见[系统维护手册](/admin/overview)。终端用户通过机器人注册并在网页投稿，不作为文档重点。

## 推荐阅读路径

1. 自助开墙：先读 [自助开墙流程](/operator/self-service-onboarding)。
2. 接手校园墙：读 [运营工作台](/operator/overview) 和 [审核与发布](/operator/review-and-publish)。
3. 接入机器人：读 [机器人管理](/operator/bots) 和 [OneBot 接入](/reference/onebot)。
4. 自托管部署：读 [快速开始](/getting-started)、[运维面板](/admin/overview) 和 [安全基线](/admin/security)。
