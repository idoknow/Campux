# Campux

校园墙自动化 解决方案。

## 文档

项目介绍和部署方式请查看：[Campux文档](https://campux.idoknow.top)(需要良好网络环境)

## 开发

### 前端

> 需要 node.js 版本高于 18

#### 安装依赖

```bash
cd frontend
npm install
```

#### 修改终结点

前端默认请求同域的后端，若前后端独立，需要在`frontend/src/store/index.js`中把`state.base_url`改为你的后端地址

#### 启动

```bash
npm run dev
```

### 后端

克隆仓库，安装依赖

```bash
go mod tidy
```

启动

```bash
go run main.go
```
