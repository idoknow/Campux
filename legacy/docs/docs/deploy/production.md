# 生产级部署

Campux 默认使用的数据库是 SQLite，默认使用的对象存储是直接存到本地。
如果需要生产级部署，推荐改为使用 MongoDB 和 MinIO。同时使用 NGINX 或 Caddy 转为 HTTPS。

以下组件建议每个组件一个目录，单独一个 docker-compose.yaml 文件，也可以根据需求自行调整。  

> 以下这些组件的问题，请自行查找其文档

## 数据库和对象存储

建议把 Campux 和数据库、对象存储放在同一个网络中，这样你可以在 Campux 配置文件中使用容器名称作为主机名访问数据库和对象存储服务。

### MongoDB

参考 docker-compose.yaml

```yaml
services:
  mongodb:
    image: mongo
    restart: always
    container_name: mongodb
    volumes:
      - ./mongodata:/data/db
    # ports:
    #   - "27017:27017"
    networks:
      - campux-network
    environment:
      - MONGO_INITDB_ROOT_USERNAME=root
      - MONGO_INITDB_ROOT_PASSWORD=<把这里改成你的密码>
      - TZ=Asia/Shanghai

networks:
  campux-network:
    external: true
```

```bash
docker compose up -d
```

然后在 Campux 的配置文件中，填写 database.mongo 的配置，并把 `database.use` 改为 `mongo`。

### MinIO


参考 docker-compose.yaml

```yaml
services:
  minio:
    image: quay.io/minio/minio
    container_name: minio
    environment:
      - MINIO_ROOT_USER=root
      - MINIO_ROOT_PASSWORD=<把这里改成你的密码>
    ports:
      - "9000:9000"
      - "9090:9090"
    volumes:
      - './data/minio:/data'
    command: server /data --console-address ":9090"
    networks:
      - campux-network

networks:
  campux-network:
    external: true
```

```bash
docker compose up -d
```

你应该会自己推测出 MinIO 的访问地址，提醒注意区分 9000 端口是 MinIO API 端口，9090 端口是控制台端口。  
访问 MinIO 控制台，创建一个 bucket，记住 bucket 名称，生成 Access Key 和 Secret Key，记下来。

然后在 Campux 的配置文件中，填写 oss.minio 的配置，并把 `oss.use` 改为 `minio`。

## 使用 HTTPS

强烈建议通过 NGINX 或 Caddy 反向代理 Campux 前端服务，以提供 HTTPS 服务。  

假设你已经购买了域名 foobar.com，你现在想把 campux.foobar.com 指向你刚刚部署的 Campux 服务。  
以下讲解以 Caddy 为例，[Caddy](https://github.com/caddyserver/caddy) 是一个现代的、易用的 Web 服务器，支持自动签署 SSL 证书，无需手动配置。

### 解析域名

在你的域名服务商处，添加一个 A 记录，将 campux.foobar.com 指向你的服务器 IP 地址。

### 配置 Caddy

在一个目录下新建用于 Caddy 的 docker-compose.yaml 文件，内容如下：

```yaml
services:
  caddy:
    image: caddy:latest
    restart: unless-stopped
    ports:
      - 80:80
      - 443:443
      - 443:443/udp
    volumes:
      - ./config/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./config/site:/srv
      - ./config/caddy-data:/data
      - ./config/caddy-config:/config
    networks:
      - campux-network

networks:
  campux-network:
    external: true
```

新建目录 config，新建文件 config/Caddyfile，内容如下：

```
campux.foobar.com {
    reverse_proxy campux:8081
}
```

### 启动 Caddy

```bash
docker compose up -d
```

没有问题的话就能通过 https://campux.foobar.com 访问到 Campux 服务了。

## 解除 QQ 域名屏蔽

一般我们在 QQ 上点击某个链接时，会出现如下被屏蔽的提示：

<img src="/assets/deploy_expose_01.jpg" alt="QQ 域名屏蔽" width="30%">

但是如果我们把主域名在腾讯云备案一次，就可以解除这个限制。

<img src="/assets/deploy_expose_02.jpg" alt="QQ 域名解除" width="30%">