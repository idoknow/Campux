# 发布状态

发布状态分为稿件状态和发布尝试状态。

> 无 Bot 模式下没有发布尝试，稿件从 `approved` 直接由管理员确认进入 `published`，见 [无 Bot 模式运营](/operator/no-bot-mode)。

![发布管理](/screenshots/publishing.png)

## 稿件状态

| 状态 | 说明 |
| --- | --- |
| `pending_approval` | 等待审核 |
| `approved` | 已审核通过：机器人模式会进发布队列；无 Bot 模式停在待发布 |
| `rejected` | 已拒绝 |
| `cancelled` | 用户已取消 |
| `publishing` | 发布任务执行中（无 Bot 模式也可能表示正在批量收集） |
| `partially_failed` | 非必需目标失败或部分失败 |
| `failed` | 必需目标失败 |
| `published` | 必需目标已完成；无 Bot 模式下表示管理员已确认手动发布 |
| `pending_recall` | 待召回（作者申请撤回，等待处理） |
| `recalled` | 已召回 |

## 发布尝试状态

| 状态 | 说明 |
| --- | --- |
| `queued` | 排队等待执行 |
| `running` | 正在执行 |
| `succeeded` | 成功 |
| `failed` | 失败，可根据错误和重试次数决定是否重试 |
| `skipped` | 跳过 |

## 判定已发布

一个稿件是否进入已发布状态，重点看必需发布目标：

- 所有必需发布目标成功：稿件可进入 `published`。
- 必需发布目标失败：稿件进入失败或部分失败状态。
- 非必需发布目标失败：可以记录失败，但不一定阻塞稿件完成。

发布管理页会按稿件分组展示每个目标的状态，方便判断到底是哪一个墙号失败。
