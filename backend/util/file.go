package util

import (
	"os"
)

func IsFileExist(path string) bool {
	_, err := os.Stat(path)
	return err == nil || os.IsExist(err)
}

func MakeSureDirExist(path string) error {
	if IsFileExist(path) {
		return nil
	}
	return os.MkdirAll(path, os.ModePerm)
}
