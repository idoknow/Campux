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

func (ps *PostService) DownloadImage(key string, ioWriter io.Writer) error {
	return ps.OSS.DownloadToIO(key, ioWriter)
}

func (ps *PostService) PostNew(uuid string, uin int64, text string, images []string, anon bool) (int, error) {

	id, err := ps.DB.CountPost()

	if err != nil {
		return -1, err
	}

	id += 1

	// TODO 检查这个用户是否有未过审的帖子
	// TODO 检查图片是否存在

	err = ps.DB.AddPost(&database.PostPO{
		ID:     id,
		UUID:   uuid,
		Uin:    uin,
		Text:   text,
		Images: images,
		Anon:   anon,
		Status: database.POST_STATUS_PENDING_APPROVAL,
	})

	if err != nil {
		return -1, err
	}

	err = ps.DB.AddPostLog(
		&database.PostLogPO{
			PostID:    id,
			Op:        uin,
			OldStat:   database.POST_STATUS_ANY,
			NewStat:   database.POST_STATUS_PENDING_APPROVAL,
			Comment:   "新稿件",
			CreatedAt: util.GetCSTTime(),
		},
	)

	if err != nil {
		return -1, err
	}

	return id, nil
}
