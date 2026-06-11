---
title: Campux 项目介绍 · 开源校园墙运营系统
description: Campux 是一套开源的校园墙运营系统，面向校园墙运营管理员，整合投稿、审核、机器人、QZone 发布与运维，一个实例统一管理多个校园墙，支持自托管部署。
---

# 项目介绍

**Campux** 是一套开源的校园墙运营系统，面向校园墙运营管理员，把投稿、审核、机器人、QZone 发布与运维整合到一个平台中。一个实例即可统一管理多个校园墙。

> 想快速了解产品全貌、功能截图与界面预览，可访问官网首页 [campux.top](https://campux.top)。

## 它能做什么

- **多墙统一管理**：一个实例管理多个校园墙，账号、成员身份、专属 host 和运维面板统一维护。
- **审核到发布闭环**：网页审核、审核群命令、QZone 发布、失败重试和详细发布日志串成完整链路。
- **Bot 原生接入**：支持 OneBot v11 WebSocket，机器人注册、重置密码、审核命令、扫码登录和 cookies 检查。
- **面向自托管**：使用 PostgreSQL、S3/MinIO、Docker Compose 和自动迁移，适合个人或团队部署。

## 文档对象

这套文档主要面向**校园墙运营管理员**：自助开墙、审核发布、机器人、成员、封禁、公告、投稿规则和运营统计。

系统维护者（部署、多租户生命周期、全局账号、域名、安全）见[系统维护手册](/admin/overview)。终端用户通过机器人注册并在网页投稿，不作为文档重点。

## 推荐阅读路径

1. **自助开墙**：先读 [自助开墙流程](/operator/self-service-onboarding)。
2. **接手校园墙**：读 [运营工作台](/operator/overview) 和 [审核与发布](/operator/review-and-publish)。
3. **接入机器人**：读 [机器人管理](/operator/bots) 和 [OneBot 接入](/reference/onebot)。
4. **自托管部署**：读 [快速开始](/getting-started)、[运维面板](/admin/overview) 和 [安全基线](/admin/security)。
