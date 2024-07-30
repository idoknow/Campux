# OAuth 2.0 接入

Campux 支持作为 OAuth 2.0 Server 为其他服务提供授权服务。通过这个功能可以快速搭建校内统一鉴权服务。

> OAuth 2.0 简介：https://www.ruanyifeng.com/blog/2014/05/oauth_2_0.html

## 配置

管理员前往 `管理` 页，`OAuth 2 应用` 面板，点击 新增。

<img src="/assets/extension_oauth_01.png" alt="新增 OAuth 2 应用" width="40%" height="40%">

填写应用名称，选择一个 Emoji，点击确定。

记录下页面上显示的 `Client ID` 和 `Client Secret`，这两个值将在 OAuth 2.0 授权流程中使用。

<img src="/assets/extension_oauth_02.png" alt="Client ID 和 Client Secret" width="50%" height="50%">

## 用户首次访问授权流程

- 假设你有 Campux 部署在 https://campux.com 。
- 假设你有服务 DemoApp，部署在 https://demoapp.com ，已经在 Campux 配置了 OAuth 2.0 应用，Client ID 为 `7RYtLq8VA45Fiprc`，Client Secret 为 `851de2eb-3fbb-40cc-8354-92a9bdf97fed`。
    - DemoApp 需要实现一个页面，用于接收 Campux 的授权回调，本例中，这个页面的地址是 `https://demoapp.com/oauth2/callback`。

### 1. 请求授权

用户访问 DemoApp，DemoApp 重定向用户到 Campux 的授权页面：

```
https://campux.com/#/auth?client_id=7RYtLq8VA45Fiprc&redirect_uri=https://demoapp.com/oauth2/callback
```

- `client_id`：Campux 分配给 DemoApp 的 Client ID。
- `redirect_uri`：授权成功后，Campux 重定向到 DemoApp 的地址。
- `state`(可选)：一个随机生成的字符串，用于防止 CSRF 攻击。

### 2. 用户授权

<img src="/assets/extension_oauth_03.png" alt="授权页面" width="50%" height="50%">

用户点击 `授权` 按钮，Campux 重定向到 DemoApp 的地址：

```
https://demoapp.com/oauth2/callback?code=eyJhbGciOiJIUzI1NiIsInR5cCI6I
```

- `code`：授权码，DemoApp 用这个授权码向 Campux 请求访问令牌。
- `state`(可选)：DemoApp 传递的 `state` 参数。

*code的有效期为 10 分钟。

### 3. DemoApp 换取访问令牌

DemoApp 的回调页面收到授权码后，向 Campux 请求访问令牌（建议使用后端请求）：

```
POST https://campux.com/v1/oauth2/get-access-token
Content-Type: application/json

{
    "client_id": "7RYtLq8VA45Fiprc",
    "client_secret": "851de2eb-3fbb-40cc-8354-92a9bdf97fed",
    "code": "eyJhbGciOiJIUzI1NiIsInR5cCI6I",
}
```

返回：

```json
{
    "code": 0,
    "msg": "ok",
    "data": {
        "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    }
}
```

<img src="/assets/extension_oauth_04.png" alt="获取访问令牌" width="80%" height="80%">

*Access Token 的有效期可以在后端配置文件中配置

### 4. DemoApp 使用 Access Token 请求资源

目前只有一个获取用户信息的接口：

```
GET https://campux.com/v1/oauth2/get-user-info
Authorization Bearer <Access Token>
```

返回：

```json
{
    "code": 0,
    "msg": "ok",
    "data": {
        "created_at": "2024-04-18T00:49:37.275Z",
        "uin": 1010553892,
        "user_group": "admin"
    }
}
```

## 用户再次访问

如果 Access Token 未过期，用户再次访问 DemoApp，DemoApp 可以直接使用 Access Token 请求资源。

若 Access Token 过期，DemoApp 需要重新按照上述流程获取 Access Token。