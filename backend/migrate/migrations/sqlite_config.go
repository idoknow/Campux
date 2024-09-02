package migrations

import (
	"github.com/RockChinQ/Campux/backend/config"
	"github.com/spf13/viper"
)

type SQLiteConfig struct{}

func (s *SQLiteConfig) Name() string {
	return "SQLiteConfig"
}

func (s *SQLiteConfig) Check() bool {
	if !viper.IsSet("database.use") {
		return true
	}

	if !viper.IsSet("database.sqlite.path") {
		return true
	}

	return false
}

func (s *SQLiteConfig) Up() error {
	viper.Set("database.use", "mongo")
	viper.Set("database.sqlite.path", "./data/campux.db")

	return config.WriteConfig()
}
