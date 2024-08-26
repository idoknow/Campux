package migrate

import "fmt"

var migrations = new(map[string]Migration)

// Migration interface
type Migration interface {
	Check() bool

	Up() error
}

// Register migration

// Do migration
func DoMigration() {
	for name, migration := range *migrations {
		if migration.Check() {
			err := migration.Up()
			if err != nil {
				fmt.Println("Migration", name, "failed:", err)
			} else {
				fmt.Println("Migration", name, "done")
			}
		}
	}
}
