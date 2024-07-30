# 对外提供服务

讲解将 Campux 暴露给用户使用的最佳实践。

## HTTPS

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
      - shared-network

networks:
  shared-network:
    external: true
```

新建目录 config，新建文件 config/Caddyfile，内容如下：

```
campux.foobar.com {
    reverse_proxy campux:8080
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