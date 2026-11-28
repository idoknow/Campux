---
title: 待发布队列接口 · Campux 文档
description: 无 Bot 模式（operate_mode=manual）下待发布稿件的分页查询、单条/批量确认发布、滞留稿件补入自动发布队列的接口说明与错误语义。
---

# 待发布队列接口

> 适用于「无 Bot 模式运营」（`operate_mode = manual`）。机器人模式（`operate_mode = bot`）下稿件审核通过后自动进入发布队列，不经过这里。

开墙向导选择「无 Bot 模式运营」，或在「管理 · 墙面设置 · 运营模式」切到无 Bot 后，审核通过的稿件停在 `approved`，由管理员在网页端「稿件 · 待发布」渲染、保存图片、手动发到 QQ 空间，再确认已发布。

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
      "createdAt": "2026-10-17T11:38:08.588Z",
      "author": { "id": "uuid", "qqUin": "123456789", "displayName": "路人甲" }
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 12, "pageCount": 2 }
}
```

渲染图地址为 `GET /api/posts/:id/render-preview`（返回 `image/jpeg`），可直接在页面内用 `<img>` 预览或下载保存。

## POST /api/admin/pending-publish/:id/confirm

确认单条稿件已手动发布，状态从 `approved` 推进到 `published`，稿件随后出现在「已发布」分组。

- 成功：`{ "ok": true }`
- `404`：稿件不存在或不属于当前校园墙
- `409`：稿件状态不是 `approved`，或（机器人模式下）已被自动发布流程接手

## POST /api/admin/pending-publish/confirm

批量确认。请求体可省略或传空对象（`{}`），表示确认当前**全部**待发布稿件；传 `ids` 则只确认指定稿件。

```json
{ "ids": ["uuid-1", "uuid-2"] }
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

## GET /api/admin/pending-publish/residual

查询切回机器人模式后仍滞留的稿件数量。

```json
{ "operateMode": "bot", "residual": 2 }
```

## POST /api/admin/pending-publish/requeue

把滞留稿件一键补入自动发布队列，按当前发布模式决定走批量入批还是逐条入队。

- 成功：`{ "ok": true, "enqueued": 2, "total": 2 }`
- `409`：当前是无 Bot 模式，滞留稿件应改用手动发布

单条入队失败只记录服务端日志，不阻断其余稿件，`enqueued` 只统计成功条数。

## 相关审计记录

| action | 触发时机 |
| --- | --- |
| `post.manual_publish` | 单条或批量确认已发布（批量时 `detail.bulk = true`，含成功条数与失败数） |
| `post.manual_requeue` | 滞留稿件补入自动发布队列 |

## 与稿件状态的关系

完整状态表见[发布状态](/reference/publish-states)。待发布队列只涉及三个状态的流转：

```text
pending_approval --审核通过--> approved --确认已发布--> published
                                   └--一键补入队列--> publishing / 批量发布
```
