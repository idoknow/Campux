# 最简部署

## 要求

### 对你的要求

- 具有很强的资料查找能力、自学能力、解决问题能力
- 熟悉 Docker 和 Docker Compose 的基本使用
- 了解 JSON 和 YAML 语法
- 我是认真仔细一字不落地读文档的好孩子🫡

### 准备工作

- 已安装 Docker 和 Docker Compose
- 仅支持 x86_64 架构 Linux
- 主机必须能正常拉取 docker hub 的镜像
    - 测试方法：`docker pull rockchin/campux:latest`

本教程假设所有组件都部署在同一个宿主机上。

另外：
- 准备一个闲置的 QQ 号用作墙号，建议使用等级较高的号，避免风控
- 准备一个 审核QQ群，把你自己和墙号都拉进去


## 创建网络

创建一个桥接网络，此教程中，我们把所有容器都置于同一个网络以便互相访问。

```bash
docker network create -d bridge campux-network
```

## 最简部署

克隆源码并cd到docker目录：

```bash
git clone https://github.com/idoknow/Campux
cd Campux/docker
```

修改 Campux/docker/docker-compose.yaml 中的需要修改的环境变量：  
即此文件中**所有**以`<>`包裹的内容（请不要保留尖括号），例如：

<img src="/assets/deploy_minimal_01.png" alt="修改环境变量" width="50%">

修改为：

<img src="/assets/deploy_minimal_02.png" alt="修改环境变量" width="50%">

注意，请确保所有以尖括号包裹的内容都已修改。

生成配置文件并启动：

```bash
docker compose up 
```

<img src="/assets/deploy_minimal_03.png" alt="启动成功" width="90%">

若 campux-bot 出现 `cookies已失效` 或 `ValueError: There are no bots to get.` 的报错，暂时不需要理会，这是由于还没配置 消息平台 导致的。

## 配置消息平台

CampuxBot 负责墙号的QQ消息处理和QQ空间操作。
机器人程序是基于 [NoneBot2](https://nonebot.dev) 框架构建的，使用 OneBot 协议，反向 WS 连接。
以上已经部署好了 CampuxBot 实例，接下来需要部署一个 消息平台（也叫协议端、逆向框架） 用于处理 QQ 的消息并转发给 CampuxBot。

<details>
<summary>我没有接触过 QQ 机器人生态？简明介绍</summary>

- 逆向框架：目前做 QQ 机器人，绝大部分是用的逆向工程框架，就是去破解 QQ 的协议实现的程序收发消息。具体选用的框架将在下文介绍。
- NoneBot：使用 Python 编写的 QQ 机器人框架，支持多种协议，包括 OneBot。
- OneBot：由于逆向框架有很多种，为了实现轻松接入，大部分框架均支持 OneBot 协议。我们在这里使用 OneBot 协议的 反向 WS 连接方式，即 CampuxBot 开放一个端口，供 逆向框架 连接上来推送消息。

</details>

### 配置 QQ 逆向框架

目前可以选用的逆向框架有很多。当前（2024-09-02）推荐使用 [Lagrange](https://github.com/LagrangeDev/Lagrange.Core)。  
关于各个框架的选用，和配置方式，可以参考我们另外一个项目（QChatGPT）的文档：[部署消息平台](https://qchatgpt.rockchin.top/deploy/platforms/aiocqhttp/lagrange.html)。  
需要注意的是，CampuxBot 仅支持 OneBot 协议，且只支持反向 WS 连接。上述文档中，只可以选用 `aiocqhttp` 目录下的框架。

### 连接 CampuxBot

不同于 QChatGPT，逆向框架连接 CampuxBot 时，ws路径是 `/onebot/v11/ws`

Lagrange 连接配置示例：

如果你使用的是容器运行 Lagrange ，那么请把 Lagrange 的容器网络也设置为 `campux-network` ，然后在 Lagrange 配置文件中 设置反向代理的 Host 为 `campux-bot`（上述 docker-compose.yaml中指定的 CampuxBot 容器名）

```json
    "Implementations": [
        {
            "Type": "ReverseWebSocket",
            "Host": "campux-bot",
            "Port": 8282,
            "Suffix": "/onebot/v11/ws",
            "ReconnectInterval": 5000,
            "HeartBeatInterval": 5000,
            "AccessToken": ""
        }
    ]
```

如果你是在宿主机上直接运行的 Lagrange 可执行文件，请把 Host 设置为 `127.0.0.1`，因为 CampuxBot 的容器开放了 8282 端口到宿主机供 消息平台 连接。

启动 消息平台，成功登录，配置成功后，CampuxBot 容器日志会输出类似下方的消息（connection open）：

```bash
05-09 16:18:02 [INFO] uvicorn | Uvicorn running on http://0.0.0.0:8282 (Press CTRL+C to quit)
05-09 16:18:09 [INFO] uvicorn | ('172.18.0.7', 42586) - "WebSocket /onebot/v11/ws" [accepted]
05-09 16:18:09 [INFO] nonebot | OneBot V11 | Bot 2297454588 connected
05-09 16:18:09 [INFO] websockets | connection open
```

此时建议重启 Campux 的容器们（如果刚刚启动了 Campux/docker/docker-compose.yaml 的容器后仍在前台，可以先按 Ctrl+C 退出），以便 CampuxBot 重新检查 Cookies：

```bash
# 回到 Campux/docker 目录执行
docker compose restart
```

一切正常的话，一两分钟后管理员QQ号会收到更新cookies的提示：

<img src="/assets/deploy_minimal_04.png" alt="部署完成" width="90%">

::: warning
由于 QQ 风控力度较大，消息平台不够稳定，故我们没有直接将消息平台的配置写到统一的 docker-compose.yaml 中，你需要自行部署。同时，我们推荐的消息平台随时都可能被风控，如果出现：QQ号登录失败、消息无法接收、无法发送的问题，请考虑更换其他消息平台（上述文档均有提及）。
:::

## 接下来阅读

- （务必）阅读初始化和维护说明：[初始化和维护](./maintain.md)
- 阅读配置文件说明：[配置文件](./config.md)
- 阅读生产级配置：[生产级配置](./production.md)