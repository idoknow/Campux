# 学校建模与 AI 自动审核设计

本文档记录 CampuxNext 在「AI 自动审核」之前需要先建设的学校建模能力，以及基于学校模型逐步落地审核副驾驶、半自动审核、自动审核的架构方案。

核心判断：**不要直接把单条稿件丢给大模型问“能不能发”。** 校园墙审核依赖强上下文：学校内部称呼、班级结构、常见地名、敏感人物、历史纠纷、墙号风格、运营规则、近期舆情。Campux 应先把投稿中持续出现的信息沉淀成每个校园墙自己的「学校模型」，再让 AI 在这个上下文里判断单条稿件风险。

## 目标

1. 为每个校园墙建立可持续更新的学校上下文模型。
2. 在审核前自动识别稿件中的学校实体、关系、场景和风险信号。
3. 用 AI 输出可解释的审核建议，而不是黑盒判定。
4. 保留人工最终决策，先做审核副驾驶，再按置信度逐步自动化。
5. 让后续运营洞察、舆情预警、投稿引导复用同一套学校模型。

## 非目标

- Phase 1 不做完全无人值守的自动发布。
- 不把 Campux 改成泛聊天助手。
- 不将大模型输出直接覆盖 `Post.status`。
- 不向普通投稿用户暴露 raw `tenantId`、内部标签、风险评分或学校画像细节。
- 不在没有人工校准和灰度数据前承诺“AI 准确识别真假”。

## 为什么先做学校建模

同一段内容在不同学校、不同时间、不同墙号里风险完全不同。

例如：

- “二号楼门口那个主任”可能是普通吐槽，也可能是持续针对某个老师的集中攻击。
- “南门奶茶店”可能是学校附近高频地点，失物招领类低风险；也可能在近期纠纷中被反复提及。
- “高二三班张某”在文本层面只是人名班级，但在校园墙审核里属于明确个人信息，发布风险高。
- 同一墙号可能允许表白和树洞，但不允许挂人、引战、广告、引流。

因此 AI 审核需要两层输入：

1. 单条稿件内容：文本、图片 OCR、附件元信息、投稿者历史行为。
2. 当前校园墙上下文：实体词典、风险规则、历史审核结果、近期热点、墙号风格。

## 学校模型的内容

学校模型不是一个静态 prompt，而是一组按校园墙隔离的数据资产。

### 1. 学校实体图谱

从历史稿件、审核日志和管理员维护中抽取：

| 类型 | 示例 | 用途 |
| --- | --- | --- |
| 地点 | 南门、二号楼、操场、食堂三楼 | 判断失物招领、聚集事件、地点风险 |
| 组织 | 高二三班、学生会、社团、宿舍楼 | 识别班级/组织隐私与冲突范围 |
| 人物称呼 | 张同学、某主任、宿管阿姨 | 识别点名、挂人、教师/学生相关风险 |
| 服务入口 | 失物招领、二手、表白、树洞 | 帮助分类和投稿补全 |
| 黑灰词 | 外卖群、兼职、刷单、代写 | 广告/诈骗/引流识别 |
| 墙号规则 | 不挂人、不得泄露联系方式 | 作为审核判断依据 |

实体应该有来源和置信度，不要把一次性噪声永久写死。

### 2. 风险记忆

按校园墙记录可解释风险模式：

- 高频被拒原因：真实姓名、班级、联系方式、攻击性语言、广告引流。
- 最近 N 天集中出现的话题或地点。
- 经常导致撤回/投诉的内容类型。
- 管理员手动标记的敏感实体或事件。
- 某类稿件的历史通过率/拒绝率。

风险记忆服务于“这条稿件为什么值得重点看”，不是为了做公开排行榜。

### 3. 墙号风格与规则

每个墙号的运营风格不同，需要结构化保存：

```json
{
  "tone": "轻松但不阴阳怪气",
  "allowAnonymous": true,
  "strictPrivacy": true,
  "allowedCategories": ["表白", "失物招领", "二手", "活动宣传", "树洞"],
  "blockedPatterns": ["挂人", "引流广告", "未经打码聊天记录"],
  "rewritePreference": "保留原意，降低攻击性，打码个人信息"
}
```

这部分可以来自租户 metadata、管理员设置、历史审核行为和后续 AI 总结。

## 数据来源

当前 CampuxNext 已有可复用数据：

- `Post.text` / `Post.attachments`：稿件正文和图片附件。
- `Post.status`：审核与发布后的状态。
- `PostLog.comment`：创建、通过、拒绝、撤回等原因。
- `AuditLog.action/detail`：审核、管理和系统操作轨迹。
- `PublishAttempt.status/lastError/verbose`：发布失败与平台反馈。
- `TenantMetadata`：墙号公告、规则、展示配置等。
- `BotAccount.reviewGroupId` / review command：审核群操作入口。

需要新增的数据主要是 AI 分析结果、学校实体和模型版本。

## 建议数据结构

### `SchoolEntity`

每个租户自己的学校实体词典。

```prisma
model SchoolEntity {
  id          String   @id @default(uuid())
  tenantId    String
  type        String   // location | class | person_alias | organization | topic | risky_phrase | service
  name        String
  aliases     Json     @default("[]")
  confidence  Float    @default(0.5)
  sensitivity String   @default("normal") // normal | sensitive | blocked
  source      String   // ai_extract | admin | audit_feedback | migration
  evidence    Json     @default("[]")
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([tenantId, type])
  @@unique([tenantId, type, name])
}
```

### `SchoolModelSnapshot`

定期固化一份可用于审核 prompt / retrieval 的校园墙上下文。

```prisma
model SchoolModelSnapshot {
  id          String   @id @default(uuid())
  tenantId    String
  version     Int
  status      String   @default("active") // active | superseded | failed
  summary     String
  entities    Json
  riskMemory  Json
  rules       Json
  metrics     Json     @default("{}")
  createdAt   DateTime @default(now())

  @@unique([tenantId, version])
  @@index([tenantId, status, createdAt])
}
```

### `PostAiAnalysis`

单条稿件的 AI 分析结果，不直接改变 `Post.status`。

```prisma
model PostAiAnalysis {
  id              String   @id @default(uuid())
  tenantId        String
  postId          String
  modelSnapshotId String?
  provider        String
  model           String
  status          String   @default("pending") // pending | running | completed | failed | skipped
  riskLevel       String?  // low | medium | high | critical
  confidence      Float?
  categories      Json     @default("[]")
  entities        Json     @default("[]")
  sensitiveFindings Json   @default("[]")
  suggestedAction String?  // approve | revise | reject | manual_review
  reasons         Json     @default("[]")
  rewrittenText   String?
  maskedText      String?
  rejectionReason String?
  rawOutput       Json?
  error           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([tenantId, status, createdAt])
  @@unique([postId, modelSnapshotId])
}
```

### `AiFeedback`

记录人工审核和 AI 建议是否一致，用来后续校准模型。

```prisma
model AiFeedback {
  id           String   @id @default(uuid())
  tenantId     String
  postId       String
  analysisId   String
  reviewerId   String?
  aiAction     String?
  humanAction  String
  humanComment String?
  matched      Boolean
  createdAt    DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([analysisId])
}
```

## 审核链路设计

### 创建投稿后

当前 `POST /api/posts` 已经会创建 `Post` 和 `PostLog`，然后通知审核群。

建议追加一个异步 job：

```text
post.created
  -> enqueue aiAnalyzePost(postId)
  -> OCR / image analysis
  -> entity extraction
  -> retrieve SchoolModelSnapshot
  -> generate PostAiAnalysis
  -> update review list badge
  -> optionally notify review group with concise risk summary
```

注意：AI job 失败不能阻塞投稿创建，也不能影响人工审核链路。

### 审核员工作台

审核列表里展示轻量标记：

- 风险等级：低 / 中 / 高 / 严重。
- 建议动作：通过 / 修改后通过 / 拒绝 / 人工重点看。
- 一句话原因：例如“包含真实姓名 + 班级信息”。
- 可展开查看：敏感实体、相关规则、改写建议、拒绝理由。

详情页提供按钮：

- `使用打码版本`
- `使用改写版本`
- `复制拒绝理由`
- `标记 AI 判断正确/错误`
- `加入敏感词/忽略该实体`

### 审核群 Bot

Bot 通知不要刷屏，只加简洁提示：

```text
#1234 新投稿
AI：中风险，疑似包含真实姓名和班级，建议打码后发布。
命令：#通过 1234 / #拒绝 <理由> 1234
```

高风险稿件可以更醒目，但仍不要自动拒绝。

## 学校模型更新链路

### 增量抽取

每条稿件分析时抽取候选实体和风险信号，但先写入候选区或低置信度实体：

```text
PostAiAnalysis.entities
  -> entity upsert candidate
  -> confidence += evidence weight
  -> if repeated / admin confirmed -> promote to SchoolEntity
```

### 周期性总结

每天或每周为每个活跃租户生成 `SchoolModelSnapshot`：

1. 聚合最近稿件、审核结果、拒绝理由、撤回/投诉信号。
2. 合并 `SchoolEntity` 中高置信实体。
3. 总结近期热点和风险模式。
4. 生成新的 snapshot version。
5. 旧 snapshot 标记 `superseded`，但保留用于追溯。

### 人工校准

管理员需要能编辑：

- 某个实体是否敏感。
- 某个词是不是误识别。
- 墙号是否允许某类投稿。
- 某条 AI 建议是否正确。

人工反馈的权重应高于 AI 自动抽取。

## Prompt 输入结构

审核 prompt 应该使用结构化输入，避免只塞一大段自然语言。

```json
{
  "tenant": {
    "wallName": "沙塘大道第一墙",
    "rules": ["不得泄露真实姓名、班级、手机号", "不发布广告引流"],
    "tone": "轻松、直接、保护隐私"
  },
  "schoolModel": {
    "knownEntities": [
      { "type": "location", "name": "南门", "sensitivity": "normal" },
      { "type": "class", "name": "高二三班", "sensitivity": "sensitive" }
    ],
    "recentRisks": ["近期挂人投稿增多", "聊天截图未打码被多次拒绝"]
  },
  "post": {
    "text": "...",
    "attachmentsOcr": ["..."],
    "anonymous": true,
    "authorRecentStats": {
      "pendingCount": 1,
      "rejectedLast30d": 0
    }
  },
  "outputSchema": {
    "riskLevel": "low|medium|high|critical",
    "suggestedAction": "approve|revise|reject|manual_review",
    "reasons": ["string"],
    "sensitiveFindings": ["string"],
    "maskedText": "string|null",
    "rejectionReason": "string|null"
  }
}
```

输出必须是 JSON，并由服务端 schema 校验。校验失败时将分析标记为 failed，不展示半截结果。

## 自动审核分级

建议分四阶段灰度。

### Stage 0：离线评估

只对历史稿件跑 AI，不影响线上审核。

验收：

- 采样对比人工审核结果。
- 统计 AI 建议与人工结果一致率。
- 找出最常见误判类型。
- 明确每个租户是否适合进入 Stage 1。

### Stage 1：审核副驾驶

线上生成 AI 分析，但只展示给审核员。

允许能力：

- 风险提示。
- 改写/打码建议。
- 拒绝理由生成。
- 审核员反馈。

不允许：

- 自动通过。
- 自动拒绝。
- 自动发布。

### Stage 2：低风险自动放行候选

只对低风险、高置信、历史一致率高的类别进入“建议自动通过”队列。

推荐规则：

```text
riskLevel = low
confidence >= 0.9
no sensitiveFindings
category in tenant.allowedAutoApproveCategories
model version has enough validated samples
```

即使自动通过，也建议先设置延迟窗口，例如 30-120 秒内审核员可拦截。

### Stage 3：租户可配置自动审核

给墙主提供开关：

- 自动通过低风险投稿。
- 自动拒绝明确广告/诈骗/联系方式泄露。
- 高风险永远人工审核。
- 每日自动审核上限。
- 自动审核日志和回滚入口。

系统层面应保留全局 kill switch。

## 安全与隐私边界

1. AI 分析结果按 `tenantId` 隔离，不能跨墙共享原始内容。
2. 训练/评估样本导出前必须脱敏。
3. 图片 OCR 可能包含手机号、QQ、微信、成绩、住址等敏感信息，默认只在审核侧展示。
4. 大模型供应商请求需要记录 provider/model/version，但不要把 API key 或完整 prompt 暴露给前端。
5. 学校模型不能公开给投稿用户，避免反向规避审核。
6. 对“真假判断”“人身风险”“校园纠纷”类内容只能给风险提示，不做确定性断言。

## UI 落点

### 投稿者侧

- 提交前检查敏感信息。
- 缺失字段提醒，例如失物招领缺地点/时间/联系方式。
- 自愿点击润色/打码。

投稿者侧要轻，不要像审查机器。

### 审核员侧

- 审核列表风险标记。
- 详情页 AI 分析卡片。
- 一键打码、一键改写、一键拒绝理由。
- AI 判断反馈。

### 管理员侧

- 墙号规则和 AI 审核策略配置。
- 学校实体管理：敏感词、地点、班级、组织。
- 自动审核灰度开关和阈值。
- AI 命中率、误判样本、人工覆盖统计。

### 系统运维侧

- AI job 队列状态。
- provider 错误率、耗时、成本。
- 每租户 AI 使用量和失败率。
- 全局禁用/降级开关。

## 与当前架构的接入点

### Server

- 在 `apps/server/src/routes/posts.ts` 创建投稿成功后 enqueue `aiAnalyzePost`。
- 在 `apps/server/src/runtime/queue.ts` 增加 job name：`aiAnalyzePost`、`refreshSchoolModel`。
- 新增 `apps/server/src/runtime/ai-review.ts` 处理 OCR、实体抽取、LLM 调用、结果落库。
- 在 review routes 查询时 include 最新 `PostAiAnalysis`。

### DB

- 在 `packages/db/prisma/schema.prisma` 增加 AI 相关表。
- migration 要保证默认不影响现有 Post 写入。
- 为 `tenantId/status/createdAt` 加索引，方便队列和后台筛选。

### Web

- 审核列表和详情页展示 AI 分析摘要。
- 管理员设置页增加 AI 策略，但普通投稿页不暴露“租户建模”等内部概念。

### Bot

- 新投稿通知可附带 AI 摘要。
- 审核命令仍由人触发。
- 高风险内容不要把敏感全文刷到群里，只提示风险类型。

## 评估指标

| 指标 | 意义 |
| --- | --- |
| AI 建议与人工审核一致率 | 判断是否可进入下一阶段自动化 |
| 高风险召回率 | 是否漏掉隐私/挂人/广告等严重风险 |
| 低风险误伤率 | 是否过度拦截正常投稿 |
| 审核平均耗时 | 是否真的提升审核效率 |
| 拒绝理由采纳率 | AI 文案是否有用 |
| 改写/打码采纳率 | 副驾驶能力是否被使用 |
| 人工覆盖率 | 自动化是否仍可控 |
| 每千稿成本 | 是否适合 SaaS 规模化 |

## 落地顺序

1. `PostAiAnalysis` 表 + 手动触发/离线脚本，对历史稿件做分析。
2. `SchoolEntity` 候选抽取 + 管理员可见的实体审阅页面。
3. 审核列表展示 AI 风险摘要。
4. 审核详情页加入改写、打码、拒绝理由。
5. `SchoolModelSnapshot` 周期性总结。
6. `AiFeedback` 采集人工审核差异，做租户级评估。
7. 低风险自动放行灰度，只对单个租户开启。
8. 管理员配置自动审核策略。

## 最小可行版本

如果只做第一版，建议包含：

- 文本投稿 AI 分析，不做图片 OCR。
- 每租户一份简单规则配置，不做完整实体图谱 UI。
- `PostAiAnalysis` 落库。
- 审核列表展示风险等级和一句话原因。
- 详情页提供打码文本、拒绝理由。
- 人工审核结果回写 `AiFeedback`。

这样可以快速验证：AI 是否真的减少审核员判断成本，以及学校上下文是否显著提升判断质量。

## 关键原则

- 学校模型是 Campux AI 审核的核心资产。
- AI 先解释和辅助，再自动决策。
- 任何自动审核都必须可追溯、可关闭、可人工覆盖。
- 租户隔离和隐私保护优先于模型效果。
- 产品形态仍然是校园墙运营工具，不是 AI 聊天产品。
