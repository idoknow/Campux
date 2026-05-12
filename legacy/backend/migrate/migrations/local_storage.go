package migrations

import (
	"github.com/RockChinQ/Campux/backend/config"
	"github.com/spf13/viper"
)

type LocalStorageConfig struct{}

func (l *LocalStorageConfig) Name() string {
	return "LocalStorageConfig"
}

func (l *LocalStorageConfig) Check() bool {
	// 检查viper是否存在oss.use配置
	if !viper.IsSet("oss.use") {
		return true
	}
	if !viper.IsSet("oss.local.dir") {
		return true
	}
	return false
}

func (l *LocalStorageConfig) Up() error {
	viper.Set("oss.use", "minio")
	viper.Set("oss.local.dir", "./data/objects")

	return config.WriteConfig()
}
