# 部署 Campux 系统组件

以下所有组件都是必需的。

## Campux 前后端

> 源码仓库：[Campux](https://github.com/idoknow/Campux)

参考 docker-compose.yaml

```yaml
services:
  campux-backend:
    image: rockchin/campux:latest
    container_name: campux
    ports:
      - 8080:8080
    volumes:
      - ./data:/app/data
    networks:
      - shared-network
    environment:
      - GIN_MODE=release

networks:
  shared-network:
    external: true
```

```bash
docker compose up
```

生成配置文件 `data/campux.yaml`

```yaml
auth:
    jwt:
        # 用户登录 Token 的有效期，单位秒
        expire: 21600
        secret: <你自定义的 JWT Token 密钥>
backend:
    host: 0.0.0.0
    port: "8080"
database:
    mongo:
        # MongoDB 中的数据库名
        db: campux
        # MongoDB 连接地址
        # 如果 MongoDB 容器和此容器处于一个网络（你按照了上一篇文档配置的MongoDB），这里的地址就是 mongodb:27017
        # 如果你自己配置了 MongoDB，那你应该知道怎么填这个地址
        uri: mongodb://root:<你的mongodb密码>@mongodb:27017
mq:
    redis:
        # redis
        # 如果 Redis 容器和此容器处于一个网络（你按照了上一篇文档配置的Redis），这里的地址就是 redis:6379
        # 如果你自己配置了 Redis，那你应该知道怎么填这个地址
        addr: redis:6379
        db: 0
        password: "<Redis 密码>"
        stream:
            # 消息队列的名称
            # 如果你多个Campux系统共用同一个Redis，这里的名称相同的key值每个系统要区分一下
            new_post: campux_new_post
            publish_post: campux_publish_post
            post_cancel: campux_post_cancel
        prefix:
            # key 前缀
            # 如果你多个Campux系统共用同一个Redis，这里的名称相同的key值每个系统要区分一下
            oauth2_code: campux_oauth2_code
        hash:
            # hash 表的名称
            # 如果你多个Campux系统共用同一个Redis，这里的名称相同的key值每个系统要区分一下
            # post_publish_status: 系统内多个bot发表一个稿件后，会在对应稿件的hash表中记录发表状态以供后端确认发表状态，这个value为hash表前缀
            #                      默认值为例，ID 为 1 的稿件，发表状态的hash表名为 campux_post_publish_status1
            post_publish_status: campux_post_publish_status
oauth2:
    server:
        # OAuth 2.0 Access Token 的加密密钥
        access_secret: 76f49aa2-4634-4696-81e0-e95fb202e9f3
        # OAuth 2.0 Access Token 的有效期，单位秒
        ak_expire: 1209600
        # OAuth 2.0 授权码的加密密钥
        code_secret: a5c6f609-e5bb-495a-a2b9-160f201049d8
oss:
    minio:
        access_key: <你的 MinIO Access Key>
        bucket: <你的 MinIO Bucket>
        # 如果 MinIO 容器和此容器处于一个网络（你按照了上一篇文档配置的MinIO），这里的地址就是 minio:9000
        endpoint: <你的 MinIO Endpoint>
        secret_key: <你的 MinIO Secret Key>
        # 如果你的 MinIO 配置了 HTTPS，这里填 true
        use_ssl: false
service:
    # 这里以 YAML 数组的形式填写你的机器人（墙号） QQ 号
    bots:
        - 123456789
    token: <服务间通信的 Token>
```

```bash
docker compose up -d
```

访问 `http://<你的 IP>:8080` 即可看到 Campux 的前端页面，但是**强烈**建议你使用 Nginx 或 Caddy 反向代理签一个证书改成 HTTPS，详细请完成部署后查看`对外提供服务`页。

## CampuxUtility 系统工具

> 源码仓库：[CampuxUtility](https://github.com/idoknow/CampuxUtility)

参考 docker-compose.yaml

```yaml
services:
  campux-backend:
    image: rockchin/campuxutility:latest
    container_name: campux-utility
    restart: always
    volumes:
      - ./data:/app/data
    networks:
      - shared-network

networks:
  shared-network:
    external: true
```

```bash
docker compose up
```

镜像包含 PlayWright 环境，体积较大，请耐心等待。
启动后开启 8999 端口，提供工具服务。

## CampuxBot 机器人程序

> 源码仓库：[CampuxBot](https://github.com/idoknow/CampuxBot)

CampuxBot 负责墙号的QQ消息处理和QQ空间操作。支持一系统多墙号的伸缩性设计，以下为单个墙号的部署过程。  
机器人程序是基于 [NoneBot2](https://nonebot.dev) 框架构建的，使用 OneBot 协议，反向 WS 连接。

<details>
<summary>我没有接触过 QQ 机器人生态？简明介绍</summary>

- 逆向框架：目前做 QQ 机器人，绝大部分是用的逆向工程框架，就是去破解 QQ 的协议实现的程序收发消息。具体选用的框架将在下文介绍。
- NoneBot：使用 Python 编写的 QQ 机器人框架，支持多种协议，包括 OneBot。
- OneBot：由于逆向框架有很多种，为了实现轻松接入，大部分框架均支持 OneBot 协议。我们在这里使用 OneBot 协议的 反向 WS 连接方式，即 CampuxBot 开放一个端口，供 逆向框架 连接上来推送消息。

</details>

### 启动实例

参考 docker-compose.yaml

```yaml
services:
  campux-bot:
    image: rockchin/campuxbot:latest
    container_name: campux-bot-<你的墙号QQ>
    restart: always
    volumes:
      - ./data:/app/data
      - .env:/app/.env
    environment:
      - TZ=Asia/Shanghai
    env_file:
      - .env
    networks:
      - shared-network

networks:
  shared-network:
    external: true
```

别急着启动，先在同目录新建一个`.env`文件，内容从 [.env.example](https://github.com/idoknow/CampuxBot/blob/main/.env.example) 复制一份贴进去，按照下面说明修改。

以下仅为说明内容，不要把这里的内容带注释复制到你的`.env`文件中，用不了的。

```bash
# OneBot 协议 反向WS 监听地址，一般不用改
HOST=0.0.0.0
# 监听端口，一般不用改
PORT=8080
# 响应命令的前缀，一般不用改
COMMAND_START=["#"]
COMMAND_SEP=["."]

# Campux 后端地址，如果 Campux 容器和此容器处于一个网络，这里的地址就是 http://campux:8080
CAMPUX_API="http://campux:8080"
# Campux 服务 Token
CAMPUX_TOKEN="campux"
# Redis 地址，如果 Redis 容器和此容器处于一个网络（你按照了上一篇文档配置的Redis），这里的地址就是 redis
CAMPUX_REDIS_HOST="redis"
CAMPUX_REDIS_PORT=6379
# Redis 密码
CAMPUX_REDIS_PASSWORD=""
# 这三个Stream也是一样，如果你多个Campux系统共用同一个Redis，这里要对应你的后端填写的Stream名称
CAMPUX_REDIS_PUBLISH_POST_STREAM="campux_publish_post"
CAMPUX_REDIS_NEW_POST_STREAM="campux_new_post"
CAMPUX_REDIS_POST_CANCEL_STREAM="campux_post_cancel"
# Hash 表名称，跟stream的相似，需要与后端配置的一致
CAMPUX_REDIS_POST_PUBLISH_STATUS_HASH="campux_post_publish_status"
# 用户发送非命令消息时回复的帮助信息，每用户每60秒只回复一次
CAMPUX_HELP_MESSAGE="发送 #注册账号 以此QQ号注册一个新账号\n发送 #重置密码 重置你的账号密码\n\n投稿地址 https://xxxxxxx"
# 群内审核命令不正确时回复的帮助信息
CAMPUX_REVIEW_HELP_MESSAGE="审核命令：\n#通过 <稿件id>\n#拒绝 <理由> <稿件id>\n\n例如：\n#通过 10\n#拒绝 测试理由 10\n\n操作命令：\n#重发 <稿件id>"

# 管理员审核群群号
CAMPUX_REVIEW_QQ_GROUP_ID=123456789
# 是否允许在群内审核，如果设为 false，新稿件将不会推送到审核群，也不允许在群内审核
CAMPUX_QQ_GROUP_REVIEW=true
# CampuxUtility 地址，如果 CampuxUtility 容器和此容器处于一个网络，这里的地址就是 http://campux-utility:8999/text2img
CAMPUX_TEXT_TO_IMAGE_API="http://campux-utility:8999/text2img"
# 发表稿件说说时的延迟，单位秒，0为不延迟。如果你有多个墙号，建议设置一个延迟，避免同时发表导致的带宽压力
CAMPUX_PUBLISH_POST_TIME_DELAY=0

# 机器人（墙号）QQ号，一定要正确！！
CAMPUX_QQ_BOT_UIN=12345678
# 管理员QQ号，QQ 空间 Cookies 失效时提醒管理员，只有管理员才能发起重新登录
CAMPUX_QQ_ADMIN_UIN=12345678
```

```bash
docker compose up -d
```

启动实例后，CampuxBot 会在 data 目录下创建 `metadata.json` 文件，用于存储机器人的元数据。

#### data/metadata.json

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

### 配置 QQ 逆向框架

目前可以选用的逆向框架有很多。当前（2024-05-09）推荐使用 [Lagrange](https://github.com/LagrangeDev/Lagrange.Core)。  
关于各个框架的选用，和配置方式，可以参考我们另外一个项目（QChatGPT）的文档：[部署消息平台](https://qchatgpt.rockchin.top/posts/deploy/platforms/aiocqhttp/)。  
需要注意的是，CampuxBot 仅支持 OneBot 协议，且只支持反向 WS 连接。上述文档中，只可以选用 `aiocqhttp` 目录下的框架。

#### 连接 CampuxBot

不同于 QChatGPT，逆向框架连接 CampuxBot 时，ws路径是 `/onebot/v11/ws`

Lagrange 连接配置示例：

```json
    "Implementations": [
        {
            "Type": "ReverseWebSocket",
            "Host": "campux-bot-<你的墙号QQ>",
            "Port": 8080,
            "Suffix": "/onebot/v11/ws",
            "ReconnectInterval": 5000,
            "HeartBeatInterval": 5000,
            "AccessToken": ""
        }
    ]
```

启动 逆向框架，成功登录，配置成功后，CampuxBot 控制台会输出类似下方的消息（connection open）：

```bash
05-09 16:18:02 [INFO] uvicorn | Uvicorn running on http://0.0.0.0:8282 (Press CTRL+C to quit)
05-09 16:18:09 [INFO] uvicorn | ('172.18.0.7', 42586) - "WebSocket /onebot/v11/ws" [accepted]
05-09 16:18:09 [INFO] nonebot | OneBot V11 | Bot 2297454588 connected
05-09 16:18:09 [INFO] websockets | connection open
```

### 多例部署

按照上述步骤，再部署一个 CampuxBot 实例即可，记得修改`.env`文件中的`CAMPUX_QQ_BOT_UIN`和其他配置。  
然后在 Campux 的 `data/campux.yaml` 中的 `service.bots` 中添加新的 QQ 号。
    
```yaml
service:
    bots:
        - 123456789
        - 987654321
    token: <服务间通信的 Token>
```