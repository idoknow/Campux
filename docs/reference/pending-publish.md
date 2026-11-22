---
title: 待发布队列接口 · Campux 文档
description: 无 Bot 模式（operate_mode=manual）下待发布稿件的查询、筛选、单条/批量确认发布、说说链接留痕、手动撤回确认、以及切模式时的滞留补投与在途发布停止接口说明。
---

# 待发布队列接口

> 适用于「无 Bot 模式运营」（`operate_mode = manual`）。机器人模式（`operate_mode = bot`）下稿件审核通过后自动进入发布队列，不经过这里。

开墙向导选择「无 Bot 模式运营」，或在「管理 · 墙面设置 · 运营模式」切到无 Bot 后，审核通过的稿件停在 `approved`，由管理员在网页端「稿件 · 待发布」渲染、保存图片、手动发到 QQ 空间，再确认已发布。

运营视角的完整流程见 [无 Bot 模式运营](/operator/no-bot-mode)。

## 前置条件

- 所有接口都需要 **管理员**（`admin`）角色，否则返回 `403`。
- 只能操作当前校园墙（按请求域名解析）下的稿件。
- 「待发布」的判定口径：`status = approved` **且** 没有任何发布尝试（`publishAttempts` 为空）、**且** 未进入批量发布（`batchItem` 为空）。已经在自动发布流程中的稿件不会出现在待发布队列里。

## GET /api/admin/pending-publish

分页读取待发布稿件。

| 查询参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `page` | 整数 ≥ 1 | `1` | 页码 |
| `limit` | 整数 1–50 | `10` | 每页条数 |
| `q` | 字符串 ≤ 80 | 无 | 关键词，匹配正文、稿件编号、作者 QQ 或昵称 |
| `anonymous` | `all` \| `anonymous` \| `named` | `all` | 匿名 / 实名筛选 |
| `withImages` | `all` \| `images` \| `text` | `all` | 只看有配图 / 只看纯文字 |
| `sort` | `oldest` \| `newest` \| `images` | `oldest` | 排序；`images` 目前等价于最新优先 |

响应：

```json
{
  "posts": [
    {
      "id": "uuid",
      "displayId": 12,
      "text": "稿件正文",
      "anonymous": false,
      "attachmentCount": 2,
      "attachments": [{ "url": "/api/uploads/post-image?key=...", "fileName": "1.jpg" }],
      "createdAt": "2026-10-17T11:38:08.588Z",
      "author": { "id": "uuid", "qqUin": "123456789", "displayName": "路人甲" }
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 12, "pageCount": 2 }
}
```

`attachments` 是稿件原始配图，管理员手动发说说时要连配图一起发。`withImages` 在本页内过滤，`pagination.total` 仍是未过滤总数。

渲染图地址为 `GET /api/posts/:id/render-preview`（返回 `image/jpeg`），可直接在页面内用 `<img>` 预览或下载保存。

## GET /api/admin/pending-publish/context

待发布工作台的物料，避免每次翻页重复拉取设置。

```json
{
  "operateMode": "manual",
  "residual": 3,
  "template": { "customText": "", "suffixText": "", "includePostId": true, "includeAuthorQq": false },
  "wallQq": "123456789",
  "ingress": { "guestSubmission": true, "aggregateLogin": false, "available": true }
}
```

`ingress.available = false` 表示这个墙没有任何用户自助进站通道（游客投稿 / 聚合登录自动建号），普通用户无法注册。

## POST /api/admin/pending-publish/:id/confirm

确认单条稿件已手动发布，状态从 `approved` 推进到 `published`，稿件随后出现在「已发布」分组。

请求体可选：

```json
{ "publishUrl": "https://user.qzone.qq.com/123/mood/abc" }
```

`publishUrl` 只接受 `http(s)` 链接，会写入 `Post.manualPublishUrl`（配合 `manualPublishedAt`），便于之后对照。非法链接会被静默忽略（存 null）。

- 成功：`{ "ok": true, "manualPublishUrl": "..." }`
- `404`：稿件不存在或不属于当前校园墙
- `409`：稿件状态不是 `approved`，或（机器人模式下）已被自动发布流程接手

## POST /api/admin/pending-publish/confirm

批量确认。请求体可省略或传空对象（`{}`），表示确认当前**全部**待发布稿件；传 `ids` 则只确认指定稿件。可同时带 `publishUrl`。

```json
{ "ids": ["uuid-1", "uuid-2"], "publishUrl": "https://..." }
```

**逐条独立处理**：单条失败（状态已变化、已被并发推进、写入异常）不会回滚其余已成功的稿件，也不会让整个请求失败。响应体同时给出成功结果和失败明细：

```json
{
  "ok": true,
  "confirmed": 3,
  "confirmedDisplayIds": [12, 13, 14],
  "failed": 2,
  "failures": [
    {
      "id": "uuid-15",
      "displayId": 15,
      "reason": "状态已变化，不再是可以确认的待发布稿",
      "code": "CONFLICT"
    },
    {
      "id": "uuid-16",
      "displayId": 16,
      "reason": "稿件已不在待发布状态（可能已被发布或进入自动队列）",
      "code": "NOT_PENDING"
    }
  ]
}
```

| `code` | 含义 |
| --- | --- |
| `NOT_PENDING` | 显式点名但稿件已不在待发布队列（已发布、已进入自动流程，或不属于当前校园墙） |
| `CONFLICT` | 写入时状态已变化，或写入本身失败 |

前端把 `failures` 以红色列表展示（稿件号 + 原因），成功的稿件立即从当前页移除，整页清空时自动回退一页。

「一键确认全部」在 UI 上会先弹二次确认框。

## POST /api/admin/pending-publish/revert

把误点「确认已发布」的稿件退回待发布。

```json
{ "ids": ["uuid-1", "uuid-2"] }
```

- 只回退 `manualPublishedAt` 非空且没有发布尝试的稿件（即管理员手动确认的）。
- 成功：`{ "ok": true, "reverted": 1, "revertedDisplayIds": [12], "failed": 1, "failures": [...] }`
- 每条的失败原因放在 `failures` 里（不存在 / 不是手动确认 / 状态已变化）。

审计记录：`post.manual_publish.revert`。

## GET /api/admin/pending-publish/residual

查询切回机器人模式后仍滞留的稿件数量，以及在途自动发布数量。

```json
{ "operateMode": "bot", "residual": 2, "inFlight": 0 }
```

- `residual`：`approved` 且从未入队的滞留稿件。
- `inFlight`：`publishing` / `partially_failed` 的稿件，用于 bot → manual 切换时提示。

## POST /api/admin/pending-publish/requeue

把滞留稿件一键补入自动发布队列，按当前发布模式决定走批量入批还是逐条入队。

- 成功：`{ "ok": true, "enqueued": 2, "total": 2 }`
- `409`：当前是无 Bot 模式，滞留稿件应改用手动发布

单条入队失败只记录服务端日志，不阻断其余稿件，`enqueued` 只统计成功条数。

## POST /api/admin/pending-publish/halt-in-flight

bot → manual 切换后，停止仍在自动队列里的稿件，把它们交回待发布，避免和手动发布重复。

- 成功：`{ "ok": true, "halted": 2, "haltedDisplayIds": [12, 13], "total": 3 }`
- `409`：当前不是无 Bot 模式

实现要点：

- 只有 `queued` / `waiting_cookies` / `failed` 的发布尝试会被标成 `skipped`；`running` 的稿件会被跳过（已经在发送中，停不下来）。
- 批量收集中的稿件会退出批次条目，状态回到 `approved`。

此外，发布 worker 在真正执行前会复查 `operate_mode`：墙已切到 manual 的，残留任务会被作废并写日志，不会偷偷发出去。

## GET /api/admin/pending-publish/:id/caption

按当前墙的「无 Bot 发布文案」模板生成一条可直接粘贴的说说文案。

```json
{ "caption": "#12\n欢迎投稿" }
```

## POST /api/review/posts/:id/recall/manual-complete

无 Bot 模式的手动撤回闭环：管理员到 QQ 空间删掉说说后，用它把稿件从 `published` / `pending_recall` 推到 `recalled`。

- 成功：`{ "ok": true }`
- `404`：稿件不存在
- `409`：状态不是 `published` / `pending_recall`

审计记录：`post.recall.manual_complete`。

> 为什么需要它：`recall/approve` 与 `recall/admin` 依赖发帖记录（tid）把说说设为仅自己可见。无 Bot 模式没有发帖记录，这些接口会返回 `409` + `code: RECALL_MANUAL_REQUIRED`，而不是假装撤回成功。

## 相关审计记录

| action | 触发时机 |
| --- | --- |
| `post.manual_publish` | 单条或批量确认已发布（批量时 `detail.bulk = true`，含成功条数、失败数与说说链接） |
| `post.manual_publish.revert` | 把误确认的稿件退回待发布 |
| `post.manual_publish.halt_in_flight` | 停止在途自动发布 |
| `post.manual_requeue` | 滞留稿件补入自动发布队列 |
| `post.recall.manual_complete` | 手动删除说说后确认撤回 |
| `tenant.operate_mode.update` | 切换运营模式 |

## 与稿件状态的关系

完整状态表见[发布状态](/reference/publish-states)。待发布队列只涉及这几个状态的流转：

```text
pending_approval --审核通过--> approved --确认已发布--> published --手动删除后确认--> recalled
                                   │                          │
                                   │                          └--退回待发布--> approved
                                   ├--一键补入队列--> publishing / 批量发布
                                   └--切到 manual 时停止在途--> approved
```
