package main

import (
	"github.com/RockChinQ/Campux/backend/config"
	"github.com/RockChinQ/Campux/backend/core"
	"github.com/RockChinQ/Campux/backend/util"
)

func main() {

	// 检查目录data
	err := util.MakeSureDirExist("data")

	if err != nil {
		panic(err)
	}

	// 配置文件
	_, created, err := config.NewConfig()

	if err != nil {
		panic(err)
	}

	if created {
		panic("请修改配置文件后重启")
	}

	// 启动服务
	app := core.NewApplication()

	app.Run()
}
