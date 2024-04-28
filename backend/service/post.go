package service

import (
	"errors"
	"io"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/mq"
	"github.com/RockChinQ/Campux/backend/oss"
	"github.com/RockChinQ/Campux/backend/util"
)

type PostService struct {
	CommonService
	OSS oss.MinioClient
	MQ  mq.RedisStreamMQ
}

func NewPostService(db database.MongoDBManager, oss oss.MinioClient, mq mq.RedisStreamMQ) *PostService {
	return &PostService{
		CommonService: CommonService{
			DB: db,
		},
		OSS: oss,
		MQ:  mq,
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

	// 检查这个用户是否有未过审的帖子
	posts, err := ps.DB.GetPosts(uin, database.POST_STATUS_PENDING_APPROVAL, 1, 1, 1)

	if err != nil {
		return -1, err
	}

	if len(posts) > 0 {
		return -1, errors.New("此用户有待审核状态的稿件")
	}

	// 检查图片是否存在
	for _, img := range images {
		exist, err := ps.OSS.CheckObjectExist(img)

		if err != nil {
			return -1, err
		}

		if !exist {
			return -1, errors.New("图片不存在")
		}
	}

	post := &database.PostPO{
		UUID:      uuid,
		Uin:       uin,
		Text:      text,
		Images:    images,
		Anon:      anon,
		Status:    database.POST_STATUS_PENDING_APPROVAL,
		CreatedAt: util.GetCSTTime(),
	}

	id, err := ps.DB.AddPost(post)

	if err != nil {
		return -1, err
	}

	// 通知到mq
	err = ps.MQ.NewPost(id)

	if err != nil {
		return -1, err
	}

	return id, nil
}

// 获取用户的帖子
func (ps *PostService) GetPosts(uin int64, status database.PostStatus, timeOrder int, page, pageSize int) ([]database.PostPO, error) {
	return ps.DB.GetPosts(uin, status, timeOrder, page, pageSize)
}

// 获取单个稿件信息
func (ps *PostService) GetPost(id int) (*database.PostPO, error) {
	return ps.DB.GetPost(id)
}

// 用户取消投稿
func (ps *PostService) UserCancelPost(uin int64, id int) error {
	// 检查状态是不是 待审核
	post, err := ps.DB.GetPost(id)

	if err != nil {
		return nil
	}

	if post.Uin != uin {
		return errors.New("无权操作他人稿件")
	}

	if post.Status != database.POST_STATUS_PENDING_APPROVAL {
		return errors.New("稿件的状态不是 待审核")
	}

	// 记录日志
	err = ps.DB.AddPostLog(
		&database.PostLogPO{
			PostID:    id,
			Op:        uin,
			OldStat:   database.POST_STATUS_PENDING_APPROVAL,
			NewStat:   database.POST_STATUS_CANCELLED,
			Comment:   "用户取消投稿",
			CreatedAt: util.GetCSTTime(),
		},
	)

	if err != nil {
		return err
	}

	return ps.DB.UpdatePostStatus(id, database.POST_STATUS_CANCELLED)
}

// 审核
func (ps *PostService) PostReview(uin int64, id int, option database.ReviewOption, comment string) error {
	// 检查状态是不是 待审核
	post, err := ps.DB.GetPost(id)

	if err != nil {
		return nil
	}

	if post.Status != database.POST_STATUS_PENDING_APPROVAL {
		return errors.New("稿件的状态不是 待审核")
	}

	newStat := database.POST_STATUS_APPROVED

	if option == database.REVIEW_OPTION_REJECT {

		if comment == "" {
			return errors.New("拒绝时必须填写理由")
		}

		newStat = database.POST_STATUS_REJECTED
	} else if option != database.REVIEW_OPTION_APPROVE {
		return errors.New("审核选项不合法")
	}

	// 记录日志
	err = ps.DB.AddPostLog(
		&database.PostLogPO{
			PostID:    id,
			Op:        uin,
			OldStat:   database.POST_STATUS_PENDING_APPROVAL,
			NewStat:   newStat,
			Comment:   comment,
			CreatedAt: util.GetCSTTime(),
		},
	)

	if err != nil {
		return err
	}

	return ps.DB.UpdatePostStatus(id, newStat)
}
