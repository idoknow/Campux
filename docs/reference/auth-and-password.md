---
title: 登录与密码接口 · Campux 文档
description: 游客注册、QQ 聚合登录（OAuth）、忘记密码与修改密码的接口说明、频率限制、验证码有效期与错误码。
---

# 登录与密码接口

本文覆盖普通用户进入校园墙的三条路径与两类密码操作：QQ 号自助注册、QQ 聚合登录（OAuth）、忘记密码，以及登录后的修改密码。运营管理员的开墙注册见[账号与权限](/admin/accounts)。

## 游客注册

开启「管理 · 插件配置 · 游客投稿」后，校园墙登录页出现注册入口。

`POST /api/auth/tenant-register`

```json
{ "qqUin": "123456789", "displayName": "路人甲", "password": "至少 6 位" }
```

- 注册成功直接建立会话，并成为该墙的「用户」（`submitter`）。
- `403`：该墙未开启游客注册
- `409`：QQ 号已注册

只读查询入口是否开放：`GET /api/auth/tenant-registration` → `{ "enabled": true, "operateMode": "manual" }`。

## QQ 聚合登录（OAuth）

登录页的第三方按钮由聚合登录插件驱动，QQ 需要同时满足：插件启用、`loginTypes` 勾选 `qq`、并配好 `appId` / `appKey` / `endpoint`。

| 接口 | 说明 |
| --- | --- |
| `GET /api/public/aggregate-login/config` | 登录页读取可用的登录方式（无需登录） |
| `GET /api/auth/aggregate-login/login-url?type=qq&returnTo=/posts` | 换取第三方授权跳转地址，同时种下 HttpOnly 的防 CSRF state cookie |
| `GET /api/auth/aggregate-login/callback?code=...` | 聚合站回跳，完成登录或绑定 |

**自动建号**：插件配置项 `aggregateLogin.autoCreateAccount` 控制首次扫码的行为。

- `false`（默认）：未绑定的第三方身份不建号，回登录页提示先登录已有账号完成绑定。
- `true`：首次扫码自动创建投稿账号并加入本墙。聚合站返回的是 openid、不暴露真实 QQ 号，因此账号用生成的合成 QQ 号，真实身份由 `OAuthIdentity` 关联；初始密码随机，用户可通过忘记密码流程自行设置。

自动建号只在本墙会员关系下生效（创建为该墙的 `submitter`），与游客注册同口径。

## 忘记密码

两步式，未登录可用。账号可以填 QQ 号或邮箱。

### 第一步：发送验证码

`POST /api/auth/password/forgot`

```json
{ "account": "123456789" }
```

**发送频率限制**（按账号维度）：

| 限制 | 值 | 超限响应 |
| --- | --- | --- |
| 两次发送最小间隔 | 60 秒 | `429`，`retryAfterSeconds` 给出剩余秒数 |
| 每小时发送上限 | 5 次 | `429`，`retryAfterSeconds = 3600` |

**验证码有效期** 10 分钟，响应里的 `expiresInSeconds = 600`。

按账号绑定情况走两条通道：

- **已绑定 QQ 邮箱**：验证码发到邮箱，响应 `{ "ok": true, "channel": "email", "email": "ab***@qq.com", "expiresInSeconds": 600 }`。站点未配置邮件服务时额外返回 `devCode`，方便自托管环境使用。
- **未绑定邮箱但绑定过第三方身份**：改走第三方身份验证，响应 `{ "ok": true, "channel": "identity", "providers": ["qq"], "devCode": "...", "expiresInSeconds": 600 }`。
- **既没邮箱也没第三方身份**：`409` + `code: "RESET_UNAVAILABLE"`，提示联系校园墙管理员重置。

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `RATE_LIMITED` | `429` | 发送过于频繁或超过每小时上限 |
| `RESET_UNAVAILABLE` | `409` | 账号没有任何可用的验证渠道，需管理员介入 |

### 第二步：校验并重置

`POST /api/auth/password/reset`

```json
{ "account": "123456789", "code": "123456", "newPassword": "新密码至少 6 位" }
```

- 成功：`{ "ok": true }`，同时清空该账号所有会话，旧登录态立即失效。
- 验证码一次性消费，重复使用会被拒绝。

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `CODE_MISSING` | `400` | 还没获取过验证码 |
| `CODE_EXPIRED` | `400` | 验证码已过期，需要重新获取 |
| `CODE_ATTEMPTS` | `429` | 单条验证码错误尝试已达 5 次 |
| `CODE_INVALID` | `400` | 验证码不正确，响应会提示剩余尝试次数 |

## 修改密码（已登录）

服务页「账户设置 · 修改密码」。

`POST /api/auth/password`

```json
{ "currentPassword": "旧密码", "newPassword": "新密码至少 6 位" }
```

- `401`：当前密码不正确
- 成功：`{ "ok": true }`

首次通过机器人建号、需强制改密的账号走 `POST /api/auth/password/required`，只提交 `newPassword`。

## 登录页的展示顺序

1. QQ 号 / 邮箱 + 密码登录
2. 第三方登录按钮（聚合登录启用时）
3. 游客注册入口（游客投稿插件启用时）
4. 「忘记密码？」入口

## 安全边界

- 验证码只存哈希（`sha256(邮箱或身份标识 + 验证码)`），库里没有明文验证码。
- 忘记密码的 state 与验证码都按账号隔离，不能跨账号使用。
- 重置成功后强制清空会话，避免旧 token 继续有效。
- 自助重置依赖账号自己的邮箱或第三方身份；两者都没有时必须由校园墙管理员处理。
