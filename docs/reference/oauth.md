# OAuth 2.0 服务器

Campux 支持作为 OAuth 2.0 Server 为其他服务提供授权服务。通过此功能可以快速搭建统一身份认证服务。

## 快速开始

### 1. 创建 OAuth 应用

在管理后台的 **Admin** 页面，进入 **OAuth 应用** 管理面板：

1. 点击 **新增应用**
2. 填写应用信息：
   - **应用名称** - 您的应用名称（必需）
   - **应用描述** - 应用的简短描述（可选）
   - **回调地址** - 授权后回调的 URL（必需，至少一个）
   - **权限范围** - 应用需要的权限（可选，默认 `profile`）
   - **PKCE 强制** - 是否强制使用 PKCE（默认启用）

### 2. 获取凭证

创建成功后，您将获得：
- **Client ID** - 应用唯一标识符
- **Client Secret** - 应用密钥（仅显示一次，请妥善保管）

## OAuth 2.0 授权流程

### 标准授权流程（Authorization Code Flow）

#### 第 1 步：请求授权

用户访问您的应用时，将用户重定向到 Campux 授权页面：

```
GET https://campux.example.com/#/auth?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&scope=profile&state=RANDOM_STRING
```

**参数说明：**

| 参数 | 必需 | 说明 |
|------|------|------|
| `client_id` | ✓ | Campux 分配的应用 ID |
| `redirect_uri` | ✓ | 授权成功后的回调地址，必须与注册时完全匹配 |
| `scope` | ✗ | 请求的权限范围，多个用空格分隔（默认使用应用注册的权限） |
| `state` | ✗ | 随机字符串，用于 CSRF 防护，原样返回 |
| `code_challenge` | ✗ | PKCE 挑战值（推荐使用） |
| `code_challenge_method` | ✗ | PKCE 方法，仅支持 `S256`（默认） |
| `response_type` | ✗ | 固定值 `code` |

**PKCE 生成示例（JavaScript）：**

```javascript
// 生成 PKCE 参数
import crypto from 'crypto';

const codeVerifier = crypto.randomBytes(32).toString('hex');
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// 保存 codeVerifier，后续兑换令牌时使用
sessionStorage.setItem('codeVerifier', codeVerifier);

// 在授权 URL 中添加
const authUrl = new URL('https://campux.example.com/#/auth');
authUrl.searchParams.append('client_id', CLIENT_ID);
authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
authUrl.searchParams.append('code_challenge', codeChallenge);
authUrl.searchParams.append('code_challenge_method', 'S256');

window.location.href = authUrl.toString();
```

#### 第 2 步：用户授权

用户在 Campux 登录后，将看到权限授权页面。用户点击 **授权** 按钮后，Campux 将重定向回您的应用：

```
https://your-app.com/callback?code=AUTH_CODE&state=RANDOM_STRING
```

**返回参数：**

| 参数 | 说明 |
|------|------|
| `code` | 授权码，有效期为 10 分钟（默认），用于兑换访问令牌 |
| `state` | 您在请求授权时提供的 `state` 参数（原样返回） |

#### 第 3 步：兑换访问令牌

您的应用后端收到授权码后，向 Campux 的令牌端点提交请求：

```
POST https://campux.example.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=AUTH_CODE&redirect_uri=YOUR_REDIRECT_URI&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&code_verifier=CODE_VERIFIER
```

**请求参数：**

| 参数 | 必需 | 说明 |
|------|------|------|
| `grant_type` | ✓ | 固定值 `authorization_code` |
| `code` | ✓ | 第 2 步中获得的授权码 |
| `redirect_uri` | ✓ | 与授权请求中的 `redirect_uri` 必须完全相同 |
| `client_id` | ✓ | 应用 ID |
| `client_secret` | ✓ | 应用密钥 |
| `code_verifier` | ✗ | 如果请求授权时使用了 PKCE，则此项必需 |

**响应示例：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "scope": "profile tenant"
}
```

**错误示例：**

```json
{
  "error": "invalid_code",
  "error_description": "Authorization code has expired"
}
```

#### 第 4 步：获取用户信息

使用访问令牌调用用户信息接口：

```
GET https://campux.example.com/oauth/userinfo
Authorization: Bearer ACCESS_TOKEN
```

**响应示例：**

```json
{
  "sub": "user-uuid-123456",
  "name": "张三",
  "preferred_username": "张三",
  "tenant_id": "tenant-uuid-123",
  "tenant_name": "示例校园",
  "tenant_slug": "example-campus",
  "scope": "profile tenant",
  "client_id": "YOUR_CLIENT_ID"
}
```

## API 参考

### OAuth 授权服务器元数据

获取 OAuth 2.0 服务器的标准配置信息：

```
GET /.well-known/oauth-authorization-server
```

**响应示例：**

```json
{
  "issuer": "https://campux.example.com",
  "authorization_endpoint": "https://campux.example.com/oauth/authorize",
  "token_endpoint": "https://campux.example.com/oauth/token",
  "revocation_endpoint": "https://campux.example.com/oauth/revoke",
  "introspection_endpoint": "https://campux.example.com/oauth/introspect",
  "userinfo_endpoint": "https://campux.example.com/oauth/userinfo",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post", "none"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["profile", "tenant"]
}
```

### 授权端点

```
GET /oauth/authorize
POST /oauth/authorize
```

**请求参数：**

| 参数 | 必需 | 类型 | 说明 |
|------|------|------|------|
| `client_id` | ✓ | string | 应用 ID |
| `redirect_uri` | ✓ | string | 授权成功后的回调地址 |
| `response_type` | ✓ | string | 固定值 `code` |
| `scope` | ✗ | string | 权限范围，多个用空格分隔 |
| `state` | ✗ | string | CSRF 防护参数 |
| `code_challenge` | ✗ | string | PKCE 挑战值 |
| `code_challenge_method` | ✗ | string | PKCE 方法，仅支持 `S256`（默认） |

**响应：**

成功返回重定向地址：
```json
{
  "redirectUrl": "https://your-app.com/callback?code=AUTH_CODE&state=RANDOM_STRING"
}
```

错误响应：
```json
{
  "message": "错误描述"
}
```

### 令牌端点

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
```

**支持的授权类型：**

#### 1. 授权码兑换 (authorization_code)

**请求参数：**

```
grant_type=authorization_code
code=AUTH_CODE
redirect_uri=YOUR_REDIRECT_URI
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
code_verifier=CODE_VERIFIER
```

#### 2. 刷新令牌 (refresh_token)

**请求参数：**

```
grant_type=refresh_token
refresh_token=REFRESH_TOKEN
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
```

**响应示例：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "scope": "profile tenant"
}
```

### 用户信息端点

```
GET /oauth/userinfo
Authorization: Bearer ACCESS_TOKEN
```

**返回用户信息：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `sub` | string | 用户唯一 ID（UUID） |
| `name` | string | 用户显示名称或 QQ 号 |
| `preferred_username` | string | 首选用户名 |
| `tenant_id` | string | 校园墙/租户 ID |
| `tenant_name` | string | 校园墙名称 |
| `tenant_slug` | string | 校园墙英文标识 |
| `scope` | string | 授予的权限范围 |
| `client_id` | string | 应用 ID |

### 令牌吊销端点

```
POST /oauth/revoke
Content-Type: application/x-www-form-urlencoded

token=ACCESS_TOKEN
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
```

用于吊销（撤销）已签发的令牌。

### 令牌检查端点

```
POST /oauth/introspect
Content-Type: application/x-www-form-urlencoded

token=ACCESS_TOKEN
client_id=YOUR_CLIENT_ID
client_secret=YOUR_CLIENT_SECRET
```

**响应示例（有效令牌）：**

```json
{
  "active": true,
  "scope": "profile tenant",
  "client_id": "YOUR_CLIENT_ID",
  "exp": 1234567890
}
```

## 权限范围 (Scopes)

| Scope | 说明 |
|-------|------|
| `profile` | 基础用户信息（用户 ID、显示名称） |
| `tenant` | 租户/校园墙相关信息（校园墙 ID、名称、标识） |

## 安全建议

### 1. 使用 HTTPS

- 生产环境必须使用 HTTPS
- 所有 OAuth 端点通信都应加密

### 2. 强制使用 PKCE

- 对于移动应用和单页应用（SPA），强制启用 PKCE
- PKCE 防止授权码拦截攻击

### 3. 验证状态参数

```javascript
// 保存 state
const state = generateRandomString(32);
sessionStorage.setItem('oauth_state', state);

// 验证返回的 state
const params = new URLSearchParams(window.location.search);
const returnedState = params.get('state');
if (returnedState !== sessionStorage.getItem('oauth_state')) {
  throw new Error('State validation failed');
}
```

### 4. 保护 Client Secret

- **不要** 在客户端代码中暴露 Client Secret
- 只在服务器后端使用 Client Secret
- 定期轮换 Client Secret

### 5. 验证 Redirect URI

- 应用必须验证返回的授权码来自正确的授权端点
- 使用严格的 URI 匹配（完全相同，不支持正则表达式）

### 6. 设置适当的令牌过期时间

- Access Token：默认 24 小时，可根据安全需求调整
- Refresh Token：默认 30 天
- Authorization Code：默认 10 分钟

## 配置管理

### OAuth 服务器设置

在管理后台配置以下参数：

| 配置项 | 默认值 | 范围 | 说明 |
|-------|-------|------|------|
| 启用 OAuth 服务 | 否 | - | 是否启用 OAuth 功能 |
| 授权码有效期 | 10 分钟 | 1-1440 分钟 | Authorization Code 的有效期 |
| Access Token 有效期 | 24 小时 | 5-10080 分钟 | 访问令牌的有效期 |
| Refresh Token 有效期 | 30 天 | 1-3650 天 | 刷新令牌的有效期 |
| 强制 PKCE | 是 | - | 是否强制所有客户端使用 PKCE |
| 允许 Plain PKCE | 否 | - | 是否允许不安全的 PKCE plain 方法 |

## 常见错误

### invalid_client

**原因：** Client ID 或 Client Secret 错误

**解决：** 确保使用正确的凭证

### invalid_code

**原因：** 授权码过期或已使用

**解决：** 授权码有效期为 10 分钟，需在此时间内兑换

### redirect_uri_mismatch

**原因：** 回调地址与注册时不匹配

**解决：** 确保使用完全相同的回调地址

### invalid_scope

**原因：** 请求的 scope 不在应用授权范围内

**解决：** 只请求应用已配置的权限

### access_denied

**原因：** 用户拒绝授权

**解决：** 这是正常情况，应用应处理用户拒绝的场景

## 客户端示例

### JavaScript/Node.js

```javascript
import fetch from 'node-fetch';

async function getAccessToken(code, codeVerifier) {
  const response = await fetch('https://campux.example.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: 'https://your-app.com/callback',
      client_id: 'YOUR_CLIENT_ID',
      client_secret: 'YOUR_CLIENT_SECRET',
      code_verifier: codeVerifier,
    }),
  });

  return response.json();
}

async function getUserInfo(accessToken) {
  const response = await fetch('https://campux.example.com/oauth/userinfo', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  return response.json();
}
```

### Python

```python
import requests
import base64
import hashlib
import secrets

def get_access_token(code, code_verifier):
    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': 'https://your-app.com/callback',
        'client_id': 'YOUR_CLIENT_ID',
        'client_secret': 'YOUR_CLIENT_SECRET',
        'code_verifier': code_verifier,
    }
    
    response = requests.post(
        'https://campux.example.com/oauth/token',
        data=data
    )
    return response.json()

def get_user_info(access_token):
    headers = {
        'Authorization': f'Bearer {access_token}'
    }
    
    response = requests.get(
        'https://campux.example.com/oauth/userinfo',
        headers=headers
    )
    return response.json()

def generate_pkce_pair():
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8').rstrip('=')
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode('utf-8')).digest()
    ).decode('utf-8').rstrip('=')
    return code_verifier, code_challenge
```

## 参考资源

- [OAuth 2.0 官方规范](https://tools.ietf.org/html/rfc6749)
- [PKCE（RFC 7636）](https://tools.ietf.org/html/rfc7636)
- [OAuth 2.0 授权码流程](https://www.rfc-editor.org/rfc/rfc6749#section-1.3.1)
