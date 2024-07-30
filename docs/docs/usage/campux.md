# Campux 前后端和系统配置

## 配置元数据

系统有一些元数据需要保存在 MongoDB 中以供使用。查看 MongoDB 的 `metadata` 集合，后端第一次启动时会自动填充一些示例数据。

### beianhao

域名备案号，这个很重要，会显示在投稿按钮下方。

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

## 添加管理员

系统部署后，第一个管理员先去找 Bot 注册账号，然后在MongoDB数据库中`account`集合找到对应的用户，将 `user_group` 字段改为 `admin`。

<img src="/assets/usage_campux_01.png" alt="添加管理员" width="50%">

刷新之后，管理员可以在 `管理` 页面设置其他账户为管理员。

<img src="/assets/usage_campux_02.png" alt="查找账户" width="50%">

点击账号卡片上的`普通用户`标签，选择新的用户组，点击`保存`。

<img src="/assets/usage_campux_03.png" alt="设置管理员" width="50%">

> 系统内有三种身份组：`admin`、`member`、`user`。`admin`可以管理所有内容，`member`可以审核稿件，`user`只能投稿。

## 封禁用户

同样的按照上方的方法找到用户，点击账号卡片上的`封禁`按钮，输入封禁原因并选择封禁时间，点击`OK`。

<img src="/assets/usage_campux_04.png" alt="封禁用户" width="50%">

如需在封禁结束之前解封，可以切到`封禁记录`页，点击用户卡片上的`解封`按钮。

<img src="/assets/usage_campux_05.png" alt="解封用户" width="50%">