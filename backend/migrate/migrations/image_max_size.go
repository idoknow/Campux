package migrations

import (
	"github.com/RockChinQ/Campux/backend/config"
	"github.com/spf13/viper"
)

type ImageMaxSize struct{}

func (i *ImageMaxSize) Name() string {
	return "ImageMaxSize"
}

func (i *ImageMaxSize) Check() bool {
	return !viper.IsSet("feature.image_max_size")
}

func (i *ImageMaxSize) Up() error {
	viper.Set("feature.image_max_size", 1024*1024*2)

	return config.WriteConfig()
}
