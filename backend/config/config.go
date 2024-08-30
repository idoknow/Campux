package config

import (
	"github.com/spf13/viper"

	"github.com/google/uuid"
)

type Config struct {
}

// 设置初始值
// 仅在配置文件不存在时调用
func SetInitValue() {
	viper.SetDefault("backend.host", "0.0.0.0")
	viper.SetDefault("backend.port", "8080")

	// jwt
	viper.SetDefault("auth.jwt.secret", uuid.New().String())
	viper.SetDefault("auth.jwt.expire", 3600*6)

	// oauth2
	viper.SetDefault("oauth2.server.code_secret", uuid.New().String())
	viper.SetDefault("oauth2.server.access_secret", uuid.New().String())
	viper.SetDefault("oauth2.server.ak_expire", 3600*24*14)

	// 服务token
	viper.SetDefault("service.token", "campux123456")
	viper.SetDefault("service.bots", []int64{123456789})
	viper.SetDefault("service.domain", "campux")

	// 数据库
	viper.SetDefault("database.use", "sqlite")

	viper.SetDefault("database.sqlite.path", "./data/campux.db")

	viper.SetDefault("database.mongo.uri", "mongodb://localhost:27017")
	viper.SetDefault("database.mongo.db", "campux")

	viper.SetDefault("oss.use", "local")

	// local
	viper.SetDefault("oss.local.dir", "./data/objects")

	// minio
	viper.SetDefault("oss.minio.endpoint", "localhost:9000")
	viper.SetDefault("oss.minio.access_key", "minio")
	viper.SetDefault("oss.minio.secret_key", "minio123")
	viper.SetDefault("oss.minio.bucket", "campux")
	viper.SetDefault("oss.minio.use_ssl", false)

	// redis
	viper.SetDefault("mq.redis.addr", "localhost:6379")
	viper.SetDefault("mq.redis.password", "campux123456")
	viper.SetDefault("mq.redis.db", 0)

}

func WriteConfig() error {
	return viper.WriteConfigAs("./data/campux.yaml")
}

// 创建配置文件对象
// 返回值1：配置文件对象
// 返回值2：是否新建配置文件
// 返回值3：错误信息
func NewConfig() (*Config, bool, error) {

	viper.SetConfigName("campux")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./data/")

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// 设置默认配置
			SetInitValue()
			// Config file not found; write default config
			if err := WriteConfig(); err != nil {
				return nil, false, err
			}
			return nil, true, nil
		} else {
			return nil, false, err
		}
	}

	return &Config{}, false, nil
}
