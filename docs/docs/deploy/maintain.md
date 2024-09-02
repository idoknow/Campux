# 初始化和维护

## 初始化系统

现在访问 `http://<宿主机IP>:8081/` 即会跳转到初始化页面，请在此页面输入初始管理员的账号（QQ号）和密码。

<img src="/assets/deploy_maintain_01.png" alt="初始化" width="80%">

之后即可使用这个账号登录系统。

## 添加管理员

管理员可以在 `管理` 页面设置其他账户为管理员。

<img src="/assets/usage_campux_02.png" alt="查找账户" width="70%">

点击账号卡片上的`普通用户`标签，选择新的用户组，点击`保存`。

<img src="/assets/usage_campux_03.png" alt="设置管理员" width="80%">

::: info
系统内有三种身份组：`admin`、`member`、`user`。`admin`可以管理所有内容，`member`可以审核稿件，`user`（新用户默认身份组）只能投稿。
:::

## 封禁用户

同样的按照上方的方法找到用户，点击账号卡片上的`封禁`按钮，输入封禁原因并选择封禁时间，点击`OK`。

<img src="/assets/usage_campux_04.png" alt="封禁用户" width="70%">

如需在封禁结束之前解封，可以切到`封禁记录`页，点击用户卡片上的`解封`按钮。

<img src="/assets/usage_campux_05.png" alt="解封用户" width="70%">

## 登录 QQ 空间

Bot 发表说说都是逆向工程，模拟 Web QQ 空间的请求。需要定期（约48小时）扫码登录。

Bot 管理员，向 Bot 发送命令 `#更新cookies` ，Bot 会返回一个二维码，管理员手机上登录 **墙号 QQ**，扫码授权即可自动登录。

<img src="/assets/insight_scenario_08.jpg" alt="扫码登录" width="40%">

没有 有效Cookies 时，Bot 会一直等待登录后再发表说说。

## 群内审核

Bot 端配置了群内审核后，新稿件到来时会推送到管理员群，管理员可以直接在群内审核。

<img src="/assets/deploy_maintain_02.png" alt="群内审核" width="50%">

## 配置元数据（重要）

可在`管理`->`元数据` 中配置元数据。

<img src="/assets/deploy_maintain_03.png" alt="元数据" width="80%">


### beianhao

域名备案号，这个很重要（[为什么？](https://help.aliyun.com/zh/icp-filing/support/website-to-add-the-record-number-faq)），会显示在投稿按钮下方。

### popup_announcement

用户登录时的弹窗公告。

例如：
```json
{
  "key": "popup_announcement",
  "value": "有诉求请使用正确的语言合理表达，我们讨厌无实际意义的情绪宣泄内容浪费计算资源！"
}
```

### banner

显示在投稿页面顶部的横幅。

### post_rules

投稿规则，以 数组形式 存储。

例如：

```json
{
  "key": "post_rules",
  "value": "[\"发表针对特定人的负面信息或发表任何人的照片，不允许匿名同时要求QQ等级高于一个太阳\",\"请勿选择不完全符合内容的标签，否则可能导致封禁\",\"以下情形拒绝:涉及政论、主义、国、党等一切敏感内容\",\"涉及时事敏感话题或有带节奏嫌疑将经过长时间讨论\",\"对于以上所有规则，运营团队保留所有解释权\"]"
}
```

### brand

系统名称。首页显示在 Campux 图标旁边。

### services

提供的服务列表。以数组形式存储。每个服务的字段都不要缺。显示在服务tab下，用户点击时能跳转。

例如：

```json
{
  "key": "services",
  "value": "[\n  {\n    \"name\": \"桂林中学毕业生去向图\",\n    \"description\": \"xxxxx\",\n    \"link\": \"https://stumap.idoknow.top\",\n    \"toast\": \"访问去向图\",\n    \"emoji\": \"🗺️\"\n  }\n]"
}
```
