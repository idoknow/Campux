# 安全基线

Campux 会处理账号、session、机器人连接 token、QZone cookies 和用户投稿内容。生产环境必须把安全配置当作上线前检查项。

## 必填 secret

生产环境必须设置：

```ini
CAMPUX_BOT_SESSION_SECRET="a-long-random-secret"
```

它用于加密存储 Bot session cookies。生产环境缺失时应用会 fail fast，避免明文或弱加密落库。

## Cookie

Session cookie 默认：

- `HttpOnly`
- `SameSite=Lax`
- `Max-Age=604800`

当 `NODE_ENV=production` 时，会额外加 `Secure`，因此生产环境必须使用 HTTPS。

## OneBot 连接 token

机器人连接 URL 中包含 `bot_id` 和 `token`。这个 URL 等价于机器人连接凭证：

- 不要公开到群聊。
- 不要写进公开 issue。
- 如果泄露，应重新生成或删除重建机器人。

## QZone cookies

QZone cookies 只能用于该机器人对应的发布目标。建议：

- 使用专用 QQ 墙号。
- 定期检查 cookies 健康状态。
- cookies 失效时通过扫码登录刷新。
- 不要把 cookies 内容粘贴到公开日志。

## 权限最小化

- 普通运营者只给租户管理员，不给系统运维。
- 审核员不应看到租户管理页。
- 普通用户只允许投稿和查看自己的稿件。
- 创建租户后及时确认哪些账号真的需要进入。
