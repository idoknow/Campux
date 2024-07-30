# Campux 前后端

## 资源

- 代码仓库：https://github.com/idoknow/Campux
- 接口文档：https://apifox.com/apidoc/shared-463342af-a8a6-4839-b175-9042d59dd6d1


## 后端

代码位于 `backend` 目录下，启动文件为根目录`main.go`。

```bash
go run main.go
```

## 前端

位于 `frontend` 目录下。


```bash
#安装依赖
npm install
```

需要先部署一个测试后端，然后修改 `frontend/src/store/index.js` 中的 `base_url` 为测试后端地址。
这种模式下，启动的前端和后端不在同一个域，但后端在调试模式下允许跨域，故可以正常使用接口。
但 Cookies 不能正常被前端 JS 修改，故无法进行退出操作。


```bash
# 启动前端调试
npm run dev
```

如果需要嵌入到后端，需要先构建前端代码：

```bash
npm run build
```

此时启动后端，访问非`/v1`开头的路径，后端将发送`frontend/dist/`目录下对应文件。
