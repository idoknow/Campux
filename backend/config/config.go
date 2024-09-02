package config

import (
	"strconv"
	"strings"

	"github.com/spf13/viper"

	"github.com/google/uuid"
)

type Config struct {
}

// 设置初始值
// 仅在配置文件不存在时调用
func SetInitValue() {
	viper.SetDefault("backend.host", "0.0.0.0")
	viper.SetDefault("backend.port", "8081")

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
	viper.SetDefault("mq.redis.addr", "campux-redis:6379")
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

	// 应用环境变量
	viper.AutomaticEnv()

	replacer := strings.NewReplacer(".", "__")

	viper.SetEnvKeyReplacer(replacer)

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// 设置默认配置
			SetInitValue()
		} else {
			return nil, false, err
		}
	}

	postOperation()

	// Config file not found; write default config
	if err := WriteConfig(); err != nil {
		return nil, false, err
	}

	return &Config{}, false, nil
}

func postOperation() {
	bots := viper.Get("service.bots")
	switch bots := bots.(type) { // 修改此行
	case []interface{}:
		// 检查是否为[]int
		for _, v := range bots { // 修改此行
			if _, ok := v.(int); !ok {
				return
			}
		}
	case string:
		botsStr := bots // 修改此行
		botsArr := strings.Split(botsStr, ",")
		var botsInt []int
		for _, bot := range botsArr {
			botInt, err := strconv.Atoi(strings.TrimSpace(bot))
			if err != nil {
				return
			}
			botsInt = append(botsInt, botInt)
		}
		viper.Set("service.bots", botsInt)
	}
}
