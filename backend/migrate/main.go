package migrate

import (
	"fmt"

	ms "github.com/RockChinQ/Campux/backend/migrate/migrations"
)

var migrations = []Migration{
	&ms.LocalStorageConfig{},
	&ms.SQLiteConfig{},
}

// Migration interface
type Migration interface {
	Name() string

	Check() bool

	Up() error
}

// Do migration
func DoMigration() error {
	for _, migration := range migrations {
		if migration.Check() {
			err := migration.Up()
			if err != nil {
				fmt.Println("Migration", migration.Name(), "failed")
				return err
			} else {
				fmt.Println("Migration", migration.Name(), "done")
			}
		}
	}
	return nil
}
