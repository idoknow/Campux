# Campux 官网首页 (campux.top)

`campux.top` 顶级域名的落地页（landing page），静态 HTML，无构建步骤。

## 内容来源

页面内容来自原 VitePress 文档首页（`docs/index.md` 的 home 布局 + 核心功能表 + 产品截图）。文档首页已改为跳转到 `/intro` 简介页，富内容统一收敛到这里。

## 视觉

遵循产品 UI 风格（见 `DESIGN.md`）：浅灰蓝底、白色卡片、细边框、品牌蓝 `#0190D5` / `#0072D3`，安静的运营工具气质，无营销式重渐变。

## 部署

通过 churros-04 的 Caddy 以静态文件托管（不是 Cloudflare Pages —— 文档站才是 Pages）：

- 文件目录（宿主）：`/opt/docker-data/caddy/caddy/config/site/landing/`，容器内挂载为 `/srv/landing`。
- Caddy 块：
  ```
  campux.top {
      root * /srv/landing
      encode gzip zstd
      try_files {path} {path}/ /index.html
      file_server
  }
  www.campux.top {
      redir https://campux.top{uri} permanent
  }
  ```
- DNS：`campux.top` / `www.campux.top` A 记录 → `45.137.180.203`（churros-04），Cloudflare 橙云代理。

### 更新页面

改完 `landing/` 后，把文件同步到宿主目录即可（Caddy 静态托管，无需 reload）：

```bash
cd landing
tar czf - index.html assets | ssh staging 'tar xzf - -C /opt/docker-data/caddy/caddy/config/site/landing'
```

资源（logo、截图）从 `docs/public/` 复制而来，更新产品截图时两处保持同步。
