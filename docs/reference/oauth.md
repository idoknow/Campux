---
title: OAuth2 接入 · Campux 文档
description: Campux 作为 OAuth2 授权服务时，第三方应用需要填写的授权链接、Token 链接、用户信息链接、回调地址、Client ID 与 Client Secret 说明。
---

# OAuth2 接入

Campux 可以作为 OAuth2 授权服务，让外部系统使用 Campux 账号登录。常见场景是把校园墙账号接入校内工具、社团系统或其它自建服务。

本文说明外部应用里应该填写哪些 OAuth 链接，以及这些链接和参数从哪里来。

## 基础地址

以下示例假设 Campux 部署在：

```text
https://campux.example.com
```

实际填写时，把它替换成你的 Campux 访问域名。生产环境请使用 HTTPS。

Campux 也提供标准 OAuth Authorization Server Metadata，可用于支持自动发现的客户端：

```text
https://campux.example.com/.well-known/oauth-authorization-server
```

## 端点链接

| 客户端字段 | 填写内容 | 说明 |
| --- | --- | --- |
| 授权地址 / Authorization URL | `https://campux.example.com/oauth/authorize` | 用户跳转到 Campux 登录并授权 |
| Token 地址 / Token URL | `https://campux.example.com/oauth/token` | 外部应用后端用授权码换取 access token |
| 用户信息地址 / UserInfo URL | `https://campux.example.com/oauth/userinfo` | 使用 access token 获取当前用户信息 |
| 撤销地址 / Revocation URL | `https://campux.example.com/oauth/revoke` | 可选，用于主动撤销 token |
| Token 检查地址 / Introspection URL | `https://campux.example.com/oauth/introspect` | 可选，用于检查 token 是否有效 |
| Issuer | `https://campux.example.com` | 一般填写 Campux 站点根地址 |

如果客户端只要求填写 `Discovery URL` 或 `Metadata URL`，优先填写 `/.well-known/oauth-authorization-server`，让客户端自动读取这些端点。

## 在 Campux 中创建 OAuth 应用

OAuth 应用按校园墙隔离。需要有对应校园墙的管理员权限。

1. 进入 Campux Web 后台，并切换到要开放 OAuth 登录的校园墙。
2. 打开 OAuth 应用管理区域。
3. 先启用 OAuth 服务。
4. 新建 OAuth 应用，填写应用名称、描述、回调地址和 scope。
5. 保存后复制 `Client ID` 和 `Client Secret`。

`Client Secret` 只在创建或重置密钥时显示一次。请立即复制到外部应用的服务端环境变量或密钥管理系统中，不要提交到代码仓库。

## 回调地址怎么填

回调地址是外部应用接收授权结果的地址，不是 Campux 的地址。

例如外部应用部署在：

```text
https://demo.example.com
```

并提供 OAuth 回调接口：

```text
https://demo.example.com/auth/campux/callback
```

那么需要：

- 在 Campux OAuth 应用的 `redirectUris` 中登记 `https://demo.example.com/auth/campux/callback`。
- 在外部应用的 `Redirect URI` / `Callback URL` 中也填写同一个地址。

Token 交换时传入的 `redirect_uri` 必须和授权时使用、并在 Campux 应用里登记的地址完全一致。协议、域名、路径和末尾斜杠不同都会导致 `redirect_uri mismatch` 或 `redirect_uri 未在应用中注册`。

本地开发可登记类似：

```text
http://localhost:3000/auth/campux/callback
```

生产环境请登记 HTTPS 地址。

## 外部应用需要填写什么

以通用 OAuth2 / OIDC 客户端为例：

| 字段 | 示例值 |
| --- | --- |
| Provider Name | `Campux` |
| Client ID | 从 Campux OAuth 应用详情复制 |
| Client Secret | 创建或重置 OAuth 应用密钥时复制 |
| Authorization URL | `https://campux.example.com/oauth/authorize` |
| Token URL | `https://campux.example.com/oauth/token` |
| UserInfo URL | `https://campux.example.com/oauth/userinfo` |
| Redirect URI / Callback URL | 外部应用自己的回调地址 |
| Scope | `profile` 或 `profile tenant` |
| Response Type | `code` |
| Grant Type | `authorization_code`，需要刷新时使用 `refresh_token` |
| PKCE | 推荐开启，默认使用 `S256` |
| Client Authentication | `client_secret_basic` 或 `client_secret_post` |

Campux 支持的 scope：

- `profile`：基础用户信息。
- `tenant`：当前校园墙信息。

如果客户端支持 PKCE，建议启用 `S256`。Campux 默认要求 PKCE，不建议使用 `plain`，除非你明确在服务端设置里允许。

## 授权流程示例

### 1. 跳转授权

外部应用把用户跳转到 Campux：

```text
https://campux.example.com/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=https%3A%2F%2Fdemo.example.com%2Fauth%2Fcampux%2Fcallback&scope=profile%20tenant&state=RANDOM_STATE&code_challenge=CODE_CHALLENGE&code_challenge_method=S256
```

参数说明：

| 参数 | 是否必填 | 说明 |
| --- | --- | --- |
| `response_type` | 是 | 固定为 `code` |
| `client_id` | 是 | Campux 分配的 Client ID |
| `redirect_uri` | 是 | 外部应用回调地址，必须已登记 |
| `scope` | 否 | 不填时使用应用允许的 scope |
| `state` | 建议 | 外部应用生成的随机值，用于防 CSRF |
| `code_challenge` | 默认必填 | PKCE challenge |
| `code_challenge_method` | 默认 `S256` | 推荐 `S256` |

用户在 Campux 登录并授权后，Campux 会跳回外部应用：

```text
https://demo.example.com/auth/campux/callback?code=AUTHORIZATION_CODE&state=RANDOM_STATE
```

授权码默认 10 分钟有效，且只能使用一次。

### 2. 换取 Token

外部应用后端向 Campux 请求 token：

```http
POST /oauth/token HTTP/1.1
Host: campux.example.com
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)

grant_type=authorization_code&code=AUTHORIZATION_CODE&redirect_uri=https%3A%2F%2Fdemo.example.com%2Fauth%2Fcampux%2Fcallback&code_verifier=CODE_VERIFIER
```

也可以把 `client_id` 和 `client_secret` 放在表单里：

```text
grant_type=authorization_code&client_id=CLIENT_ID&client_secret=CLIENT_SECRET&code=AUTHORIZATION_CODE&redirect_uri=https%3A%2F%2Fdemo.example.com%2Fauth%2Fcampux%2Fcallback&code_verifier=CODE_VERIFIER
```

成功返回：

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "refresh_token": "...",
  "scope": "profile tenant"
}
```

`expires_in` 的单位是秒。默认 access token 有效期为 24 小时，refresh token 有效期为 30 天，具体值以校园墙 OAuth 服务设置为准。

### 3. 获取用户信息

```http
GET /oauth/userinfo HTTP/1.1
Host: campux.example.com
Authorization: Bearer ACCESS_TOKEN
```

返回示例：

```json
{
  "sub": "user_id",
  "name": "123456789",
  "username": "张三",
  "tenant_id": "tenant_id",
  "tenant_name": "示例校园墙",
  "tenant_slug": "example",
  "scope": "profile tenant",
  "client_id": "CLIENT_ID"
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `sub` | Campux 用户 ID，适合作为外部应用绑定用户的唯一标识 |
| `name` | 用户 QQ 号字符串 |
| `username` | 用户显示名；没有显示名时返回 QQ 号 |
| `tenant_id` | 当前授权所属校园墙 ID |
| `tenant_name` | 当前授权所属校园墙名称 |
| `tenant_slug` | 当前授权所属校园墙 slug |
| `scope` | 本次 token 实际拥有的 scope |
| `client_id` | 本次授权使用的 OAuth Client ID |

## 刷新和撤销 Token

刷新 token：

```text
POST https://campux.example.com/oauth/token
grant_type=refresh_token&refresh_token=REFRESH_TOKEN&client_id=CLIENT_ID&client_secret=CLIENT_SECRET
```

撤销 token：

```text
POST https://campux.example.com/oauth/revoke
token=ACCESS_OR_REFRESH_TOKEN&token_type_hint=access_token&client_id=CLIENT_ID&client_secret=CLIENT_SECRET
```

检查 token：

```text
POST https://campux.example.com/oauth/introspect
token=ACCESS_TOKEN&client_id=CLIENT_ID&client_secret=CLIENT_SECRET
```

## 常见错误

| 错误 | 常见原因 | 处理方式 |
| --- | --- | --- |
| `当前校园墙未启用 OAuth 服务` | 校园墙 OAuth 服务未开启 | 在对应校园墙后台启用 OAuth 服务 |
| `未找到 OAuth 应用` | `client_id` 不存在、应用被禁用或不属于当前校园墙 | 检查 Client ID、应用状态和校园墙上下文 |
| `redirect_uri 未在应用中注册` | 授权请求中的回调地址没有登记 | 把外部应用回调地址加入 Campux OAuth 应用 |
| `redirect_uri mismatch` | 换 token 时的 `redirect_uri` 和授权时不一致 | 确保两处完全相同 |
| `PKCE code_challenge 是必需的` | 服务端或应用要求 PKCE，但授权请求没带 challenge | 客户端启用 PKCE S256 |
| `invalid_client` | Client ID/Secret 缺失或错误 | 重新复制 Client ID，必要时重置 Client Secret |
| `invalid_grant` | 授权码过期、已使用、错误或 PKCE verifier 不匹配 | 重新发起授权流程，并检查 PKCE 实现 |

## 安全建议

- 生产环境必须使用 HTTPS，否则授权码、token 和 session 可能被窃取。
- `Client Secret` 只放在服务端，不要放进浏览器前端代码。
- 每个外部应用单独创建 OAuth 应用，不要共用同一组 Client ID/Secret。
- 回调地址只登记可信域名，避免使用通配或不受控跳转。
- 使用 `state` 防 CSRF，使用 PKCE S256 防授权码拦截。
- 外部应用应保存 `sub` 作为稳定用户标识，不要只依赖显示名。
