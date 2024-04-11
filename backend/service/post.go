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

func (ps *PostService) PostNew(uuid string, uin int64, text string, images []string, anon bool) error {

	id, err := ps.DB.CountPost()

	if err != nil {
		return err
	}

	// TODO 检查这个用户是否有未过审的帖子
	// TODO 检查图片是否存在

	return ps.DB.AddPost(&database.PostPO{
		ID:     id + 1,
		UUID:   uuid,
		Uin:    uin,
		Text:   text,
		Images: images,
		Anon:   anon,
	})
}
