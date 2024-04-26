package config

import (
	"github.com/spf13/viper"
)

type Config struct {
}

func SetDefault() {
	viper.SetDefault("backend.host", "0.0.0.0")
	viper.SetDefault("backend.port", "8080")

	// jwt
	viper.SetDefault("auth.jwt.secret", "campux")
	viper.SetDefault("auth.jwt.expire", 3600)

	// 服务token
	viper.SetDefault("service.token", "campux")

	// 数据库
	viper.SetDefault("database.mongo.uri", "mongodb://localhost:27017")
	viper.SetDefault("database.mongo.db", "campux")

	// minio
	viper.SetDefault("oss.minio.endpoint", "localhost:9000")
	viper.SetDefault("oss.minio.access_key", "minio")
	viper.SetDefault("oss.minio.secret_key", "minio123")
	viper.SetDefault("oss.minio.bucket", "campux")
	viper.SetDefault("oss.minio.use_ssl", false)

	// redis
	viper.SetDefault("mq.redis.addr", "localhost:6379")
	viper.SetDefault("mq.redis.password", "")
	viper.SetDefault("mq.redis.db", 0)
	viper.SetDefault("mq.redis.stream.publish_post", "campux_publish_post")

}

// 创建配置文件对象
// 返回值1：配置文件对象
// 返回值2：是否新建配置文件
// 返回值3：错误信息
func NewConfig() (*Config, bool, error) {

	viper.SetConfigName("campux")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./data/")

	// 设置默认配置
	SetDefault()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// Config file not found; write default config
			if err := viper.WriteConfigAs("./data/campux.yaml"); err != nil {
				return nil, false, err
			}
			return nil, true, nil
		} else {
			return nil, false, err
		}
	}

	return &Config{}, false, nil
}
