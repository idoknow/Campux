# Webhook Feature Implementation Summary

## 功能概述 (Feature Overview)

本PR为Campux添加了webhook功能，管理员可以在前端管理页面配置webhook目标地址，当稿件状态变更时，系统会向所有配置的webhook地址发送事件通知。

This PR adds webhook functionality to Campux, allowing administrators to configure webhook target URLs in the admin panel. When article status changes, the system sends event notifications to all configured webhook URLs.

## 实现的功能 (Implemented Features)

### 1. 后端 (Backend)

#### 数据模型 (Data Model)
- 新增 `WebhookPO` 结构体用于存储webhook配置
- 包含ID、URL和创建时间字段
- 支持SQLite和MongoDB两种数据库

#### 数据库操作 (Database Operations)
- `AddWebhook(webhook *WebhookPO)` - 添加webhook
- `GetWebhooks()` - 获取所有webhook
- `DeleteWebhook(id int)` - 删除webhook

#### Webhook服务 (Webhook Service)
- 新增 `WebhookService` 用于管理webhook和发送通知
- `NotifyWebhooks(event string, post *PostPO)` - 异步发送webhook通知
- 自动序列化事件数据为JSON格式
- 10秒超时保护

#### API端点 (API Endpoints)
- `POST /v1/admin/add-webhook` - 添加webhook（仅管理员）
- `GET /v1/admin/get-webhooks` - 获取webhook列表（仅管理员）
- `DELETE /v1/admin/del-webhook/:id` - 删除webhook（仅管理员）

#### 事件触发点 (Event Trigger Points)
Webhook通知会在以下状态变更时触发：
1. **post_approved** - 稿件被审核通过
2. **post_rejected** - 稿件被拒绝
3. **post_cancelled** - 用户取消投稿
4. **post_in_queue** - 稿件进入发布队列
5. **post_published** - 稿件成功发布

### 2. 前端 (Frontend)

#### 新增组件 (New Components)
- `WebhookCard.vue` - Webhook卡片组件，用于展示和管理单个webhook
- 仿照 `OAuthAppCard.vue` 的设计风格
- 支持显示URL、创建时间和删除操作

#### 管理界面 (Admin Interface)
在 `admin.vue` 页面新增：
- 新标签页 "🪝 Webhook"（仅管理员可见）
- 添加webhook按钮和刷新按钮
- Webhook列表展示
- 添加webhook对话框（输入URL）
- 删除确认对话框

### 3. 测试工具 (Testing Tools)

#### 测试服务器
- `test_webhook_server.py` - Python实现的webhook测试服务器
- 接收并打印所有webhook POST请求
- 格式化显示事件类型、稿件信息等
- 使用方法：`python3 test_webhook_server.py [端口]`

#### 文档
- `WEBHOOK_TESTING.md` - 完整的webhook测试和使用指南
- 包含事件格式、API文档、使用说明

## 技术实现细节 (Technical Details)

### 异步通知 (Asynchronous Notifications)
- 所有webhook通知都是异步发送（使用goroutine）
- 不会阻塞主业务流程
- 失败的webhook调用不影响稿件状态变更

### 安全性 (Security)
- 所有webhook API都需要管理员权限
- CodeQL安全扫描：0个警告
- URL存储限制：512字符

### 数据库兼容性 (Database Compatibility)
- 完整支持SQLite（使用GORM）
- 完整支持MongoDB（使用官方driver）
- 自动表/集合创建和迁移

## 文件变更统计 (File Changes)

```
14 files changed, 491 insertions(+), 18 deletions(-)

Backend:
- backend/database/po.go                       (+6)
- backend/database/base.go                     (+3)
- backend/database/sqlite.go                   (+18)
- backend/database/mongo.go                    (+27)
- backend/service/webhook.go                   (+76, new file)
- backend/service/post.go                      (+18, modified)
- backend/service/routine/confirm_posted.go    (+7, modified)
- backend/service/routine/schedule_publishing.go (+7, modified)
- backend/controller/admapi.go                 (+111)
- backend/controller/api.go                    (+3)
- backend/core/app.go                          (+9)

Frontend:
- frontend/src/components/WebhookCard.vue      (+97, new file)
- frontend/src/pages/admin.vue                 (+99)

Others:
- .gitignore                                   (+1)
- WEBHOOK_TESTING.md                           (+77, new file)
- test_webhook_server.py                       (+65, new file)
```

## 使用示例 (Usage Example)

1. 启动测试webhook服务器：
```bash
python3 test_webhook_server.py 8000
```

2. 在Campux管理页面添加webhook：
   - 访问管理页面
   - 点击 "🪝 Webhook" 标签
   - 点击 "添加 Webhook"
   - 输入 `http://localhost:8000/webhook`
   - 保存

3. 当稿件状态变更时，测试服务器会收到并打印webhook通知

## 验证清单 (Verification Checklist)

- [x] 后端编译成功
- [x] 前端编译成功
- [x] 数据库模型正确定义
- [x] API端点实现完整
- [x] 前端UI集成完成
- [x] Webhook通知集成到所有状态变更点
- [x] 异步发送实现
- [x] 权限检查实现
- [x] CodeQL安全检查通过（0警告）
- [x] 测试工具和文档完备

## 待测试项 (To Be Tested Manually)

1. 在真实环境中添加webhook
2. 测试各种稿件状态变更触发webhook
3. 验证webhook接收到的数据格式正确
4. 测试删除webhook功能
5. 验证权限控制（非管理员无法访问）

---

**实现完成日期**: 2024-11-08
**实现者**: GitHub Copilot
**PR状态**: Ready for Review
