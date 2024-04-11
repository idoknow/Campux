package service

import (
	"io"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/oss"
	"github.com/RockChinQ/Campux/backend/util"
)

type PostService struct {
	DB  database.MongoDBManager
	OSS oss.MinioClient
}

func NewPostService(db database.MongoDBManager, oss oss.MinioClient) *PostService {
	return &PostService{
		DB:  db,
		OSS: oss,
	}
}

func (ps *PostService) UploadImage(ioReader io.Reader, suffix string) (string, error) {
	allowedSuffix := []string{"jpg", "jpeg", "png", "gif", "bmp"}

	if !util.StringInSlice(suffix, allowedSuffix) {
		return "", ErrInvalidImageSuffix
	}

	return ps.OSS.UploadFromIO(ioReader, suffix)
}
