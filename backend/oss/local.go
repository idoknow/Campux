package oss

import (
	"io"
	"os"
	"path/filepath"

	"github.com/RockChinQ/Campux/backend/util"
	"github.com/spf13/viper"
)

type LocalStorage struct {
	dir string
}

func NewLocalStorage() *LocalStorage {

	err := util.MakeSureDirExist(viper.GetString("oss.local.dir"))

	if err != nil {
		panic(err)
	}

	return &LocalStorage{
		dir: viper.GetString("oss.local.dir"),
	}
}

func (l *LocalStorage) UploadFromIO(ioReader io.Reader, suffix string) (string, error) {
	objectName := generateObjectName()

	key, err := l.UploadFromIOWithKey(ioReader, objectName, suffix)

	return key, err
}

func (l *LocalStorage) UploadFromIOWithKey(ioReader io.Reader, key string, suffix string) (string, error) {
	if suffix != "" {
		key += "." + suffix
	}

	file, err := os.Create(filepath.Join(l.dir, key))
	if err != nil {
		return "", err
	}
	defer file.Close()

	_, err = io.Copy(file, ioReader)
	return key, err
}

func (l *LocalStorage) DownloadToIO(objectName string, ioWriter io.Writer) error {
	file, err := os.Open(filepath.Join(l.dir, objectName))
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = io.Copy(ioWriter, file)
	return err
}

func (l *LocalStorage) CheckObjectExist(objectName string) (bool, error) {
	_, err := os.Stat(filepath.Join(l.dir, objectName))
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
