# 配置和维护

## 配置文件和环境变量

### Campux 

Campux 的配置文件位于 `Campux/docker/volumes/campux/config.yaml`。修改后请重启容器：

```yaml
auth:
    jwt:
        # 用户登录的 JWT Token 有效期
        expire: 21600
        # 用户 JWT Token 的加密密钥
        secret: ce798888-ff21-4c47-8a7e-0bdf6af5231a
backend:
    # 后端监听的地址
    host: 0.0.0.0
    # 后端监听的端口
    port: "8081"
database:
    # MongoDB 配置
    mongo:
        # MongoDB 数据库名
        db: campux
        # MongoDB URI
        uri: mongodb://localhost:27017
    sqlite:
        # SQLite 数据库文件地址
        path: ./data/campux.db
    # 选择使用哪种数据库，目前支持 sqlite 和 mongo
    use: sqlite
mq:
    redis:
        # redis 地址和端口
        addr: campux-redis:6379
        # redis 使用的数据库
        db: 0
        # redis 密码
        password: campux123456
oauth2:
    # OAuth 2.0 Server 配置
    server:
        # Access Token 签发密钥
        access_secret: 16d79012-edfc-4125-8b0d-e5c13abd03c8
        # Access Token 过期时间
        ak_expire: 1209600
        # OAuth App 鉴权 Code 密钥
        code_secret: c2751e28-06b8-4510-939c-81edb4ddb563
oss:
    local:
        # 本地存储的目录
        dir: ./data/objects
    minio:
        # MinIO 的 Access Key
        access_key: minio
        # MinIO 的 Bucket
        bucket: campux
        # MinIO 的 API 地址
        endpoint: localhost:9000
        # MinIO 的 Secret Key
        secret_key: minio123
        # 是否使用 SSL，如果 Endpoint 签发了 SSL 证书，就改为 true
        use_ssl: false
    # 选择使用哪种文件存储服务，目前支持 local 和 minio
    use: local
service:
    # 系统中的 墙号QQ号，以数组形式提供
    bots:
        - 1099044697
    # 本系统的名称，不是广义上的域名，只与redis中的隔离有关，如果多个campux系统共用一个redis，才需要修改这个配置
    # 需要确保 campux 与其诸个 CampuxBot 的 domain 配置相同
    domain: campux
    # CampuxBot 访问 token
    token: campux123456
```

#### 通过环境变量修改 Campux 配置

- 使用`__`（两个下划线）表示配置文件中的`.`，例如`OSS__USE`代表`oss.use`，`OAUTH2__SERVER__AK_EXPIRE`表示`oauth2.server.ak_expire`。
- 环境变量的名称必须为全部大写。  
- 数组使用`,`分割每个元素，例如设置 service.bots 时，可以使用`SERVICE_BOTS=114514,1919810`表示该系统内有`114514`和`1919810`两个墙号
- 环境变量会**覆盖并写入**配置文件中的值

### CampuxBot

#### 配置文件

CampuxBot 的配置文件位于 `Campux/docker/campuxbot/config.json`。修改后请重启容器：  
注意，json不支持注释，请勿直接复制下方示例。

```json
{
    // NoneBot2 的 OneBot 11 适配器监听的 反向WS 地址
    "host": "0.0.0.0",
    // OneBot 11 适配器监听的 反向WS 端口
    "port": 8283,
    // 命令前缀，支持多个，例如 ["#", "＃"]
    "command_start": [
        "#",
        "＃"
    ],
    // 命令分隔符，支持多个，例如 ["."]
    "command_sep": [
        "."
    ],
    // Campux 后端地址
    "campux_api": "http://campux:8081",
    // Campux 后端访问 Token
    "campux_token": "campux123456",
    // Redis 地址
    "campux_redis_host": "campux-redis",
    // Redis 端口
    "campux_redis_port": 6379,
    // Redis 密码
    "campux_redis_password": "campux123456",
    // 是否允许群内审核
    "campux_qq_group_review": true,
    // 稿件渲染服务 CampuxUtility API 地址
    "campux_text_to_image_api": "http://campux-utility:8999/text2img",
    // 每次稿件发表前的强制延迟，单位秒
    "campux_publish_post_time_delay": 0,
    // 私聊墙号时未触发命令时的回复消息
    "campux_help_message": "发送 #注册账号 以此QQ号注册一个新账号(前面需要加#号)\n发送 #重置密码 重置你的账号密码\n\n投稿地址 https://gz.idoknow.top （若打不开请更换浏览器尝试）",
    // 群内审核时消息不符合命令时的回复消息
    "campux_review_help_message": "审核命令：\n#通过 <稿件id>\n\n#拒绝 <理由> <稿件id>\n\n例如：\n#通过 10\n#拒绝 测试理由 10",
    // 审核群群号
    "campux_review_qq_group_id": 422250630,
    // 见 Campux 配置文件中的 domain 字段
    "campux_domain": "campux",
    // 墙号 QQ 号
    "campux_qq_bot_uin": 1099044697,
    // 管理员 QQ 号
    "campux_qq_admin_uin": 1010553892
}
```

##### 通过环境变量修改 CampuxBot 配置

- 直接使用字段名代表字段，大小写均可，例如：`CAMPUX_QQ_BOT_UIN`和`campux_qq_bot_uin`均代表配置文件中的此字段
- 环境变量会**覆盖并写入**配置文件中的值

#### 元数据文件


启动实例后，CampuxBot 会在 data（Campux/docker/volumes/campuxbot/） 目录下创建 `metadata.json` 文件，用于存储机器人的元数据。

- post_publish_text   发表说说到空间时，附带的文字，使用 Python 语法描述

  - 默认为 `'#' + str(post_id)` 仅附带稿件 ID  
  - 支持的变量: text 稿件文本, post_id 稿件ID, uin 发布者QQ号, post 稿件对象(可以在CampuxBot的代码 campux/common/entity.py 中看到其定义)
  - 支持的函数: at(uin) 在文本中插入@某人, links() 提取文本中的链接并返回列表
  - 示例：

      ```json
      {
          "post_publish_text": "'#' + str(post_id) + ' ' + (at(uin) if not post.anon else '') + '\\n' + '\\n'.join(links())"
      }

      效果：
      #<稿件 ID> <@发布者(如果是匿名则为空)>
      <链接1>
      <链接2>
      ```

#### 缓存数据

存放 CampuxBot 实例的缓存信息，例如 QQ 空间的Cookies。位于 `Campux/docker/volumes/campuxbot/cache.json`。