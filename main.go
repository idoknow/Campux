package main

import (
	"github.com/RockChinQ/Campux/backend/config"
	"github.com/RockChinQ/Campux/backend/core"
)

func main() {
	// 配置文件
	_, created, err := config.NewConfig()

	if err != nil {
		panic(err)
	}

	if created {
		panic("请修改配置文件")
	}

	// 启动服务
	app := core.NewApplication()

	app.Run()
}
