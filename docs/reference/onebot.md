# OneBot 接入

Campux 使用 OneBot v11 WebSocket 与 QQ 协议端通信。

![机器人管理](/screenshots/bot-management.png)

## 连接地址

在“管理 / 机器人”中复制连接 URL：

```text
ws://localhost:8989/onebot/v11/ws?bot_id=<bot-id>&token=<connection-token>
```

生产环境通常是：

```text
wss://campux.example.com/onebot/v11/ws?bot_id=<bot-id>&token=<connection-token>
```

协议端必须带上 `bot_id` 和 `token`。Campux 会用它们查找启用中的机器人，并得到对应租户。

## 支持的能力

Campux 当前使用这些 OneBot 能力：

- 接收私聊消息。
- 接收群消息。
- 发送私聊消息。
- 发送审核群消息。
- 获取 cookies。
- 发送图片消息。
- 读取 `self_id` 并校验连接身份。

不同协议端对获取 QZone cookies 的支持不一致。如果协议端不支持，请使用扫码登录。

## 私聊命令

用户常用私聊命令：

```text
#注册
#重置密码
```

非命令私聊消息会触发可配置自动回复。自动回复有限速，命令不受限速影响。

## 审核群命令

审核群常用命令：

```text
#通过 <稿件编号>
#拒绝 <理由> <稿件编号>
#重发 <稿件编号>
#登录
#扫码登录
```

可以 at 机器人再写命令。Campux 会识别 at 后的命令文本。

## 连接排查

如果协议端显示连接成功但 Campux 没有最近连接时间：

1. 检查 URL 是否是当前机器人卡片里的最新 URL。
2. 检查 token 是否被截断。
3. 检查协议端上报的 `self_id` 是否等于 Bot QQ。
4. 检查反向代理是否支持 WebSocket upgrade。
