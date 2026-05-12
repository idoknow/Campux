package oss

import "io"

type BaseOSSProvider interface {
	UploadFromIO(io.Reader, string) (string, error)
	UploadFromIOWithKey(io.Reader, string, string) (string, error)
	DownloadToIO(string, io.Writer) error
	CheckObjectExist(string) (bool, error)
}
