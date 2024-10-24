package controller

import (
	"bytes"
	"fmt"
	"strconv"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/RockChinQ/Campux/backend/util"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

type PostRouter struct {
	APIRouter
	PostService    service.PostService
	AccountService service.AccountService
}

func NewPostRouter(rg *gin.RouterGroup, ps service.PostService, as service.AccountService) *PostRouter {
	pr := &PostRouter{
		PostService:    ps,
		AccountService: as,
	}

	group := rg.Group("/post")

	// bind routes
	group.POST("/upload-image", pr.UploadImage)
	group.POST("/post-new", pr.PostNew)
	// download-image/{image-key}
	group.GET("/download-image/:key", pr.DownloadImage)
	group.POST("/get-self-posts", pr.GetSelfPosts)
	group.POST("/get-posts", pr.GetPosts)
	group.GET("/get-post-info/:id", pr.GetPostInfo)
	group.POST("/user-cancel", pr.UserCancelPost)
	group.POST("/review-post", pr.ReviewPost)
	group.POST("/post-log", pr.PostPostLog)
	group.GET("/post-log/:id", pr.GetPostLog)
	group.POST("/submit-verbose", pr.SubmitPostVerbose)

	return pr
}

// 上传图片
func (pr *PostRouter) UploadImage(c *gin.Context) {
	_, err := pr.GetUin(c)

	if err != nil {
		pr.StatusCode(c, 401, err.Error())
		return
	}

	// 取body的json里的图片数据
	file, err := c.FormFile("image")
	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}
	// 检查图片大小
	if file.Size > int64(viper.GetInt("feature.image_max_size")) {
		pr.Fail(c, 1, fmt.Sprintf("图片文件过大 (%.2f MB > %.2f MB)", float64(file.Size)/1024/1024, float64(viper.GetInt("feature.image_max_size"))/1024/1024))
		return
	}

	suffix := c.Request.FormValue("suffix")

	fileReader, err := file.Open()

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 上传图片
	key, err := pr.PostService.UploadImage(fileReader, suffix)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{
		"key": key,
	})
}

// 发布新稿件
func (pr *PostRouter) PostNew(c *gin.Context) {
	// 从jwt取uin
	uin, err := pr.GetUin(c)

	if err != nil {
		pr.StatusCode(c, 401, err.Error())
		return
	}

	// 检查是否被ban
	if pr.CheckIfBanned(c, pr.AccountService, uin) {
		return
	}

	// 取body的json里的uuid, uin, text, images, anon
	var body PostNewBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 发布新稿件
	id, err := pr.PostService.PostNew(body.UUID, uin, body.Text, body.Images, *body.Anon)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{
		"id": id,
	})
}

// 下载图片
func (pr *PostRouter) DownloadImage(c *gin.Context) {

	_, err := pr.Auth(c, Both)

	if err != nil {
		return
	}

	key := c.Param("key")
	_, isPreview := c.GetQuery("preview")

	buf := bytes.NewBuffer(nil)

	if isPreview {
		err = pr.PostService.PreviewImage(key, buf)
	} else {
		err = pr.PostService.DownloadImage(key, buf)
	}

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 下载图片，直接返回内容
	// data, err := pr.PostService.DownloadImage(key)
	c.Writer.Header().Set("Content-Type", "image/jpeg")

	c.Data(200, "application/octet-stream", buf.Bytes())
}

// 获取用户自己的帖子
func (pr *PostRouter) GetSelfPosts(c *gin.Context) {
	// 从jwt取uin
	uin, err := pr.GetUin(c)

	if err != nil {
		pr.StatusCode(c, 401, err.Error())
		return
	}

	// 取body的json里的status, time_order, page, page_size
	var body GetSelfPostsBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 获取用户自己的帖子
	posts, total, err := pr.PostService.GetPosts(
		uin,
		body.Status,
		*body.TimeOrder,
		*body.Page,
		*body.PageSize,
	)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{
		"list":  posts,
		"total": total,
	})
}

// 获取稿件列表
func (pr *PostRouter) GetPosts(c *gin.Context) {

	uin, err := pr.Auth(c, Both)

	if err != nil {
		return
	}

	// 检查用户权限
	if !pr.PostService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
		database.USER_GROUP_MEMBER,
	}) {
		pr.StatusCode(c, 401, "权限不足")
		return
	}

	var body GetPostsBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 获取稿件列表
	posts, total, err := pr.PostService.GetPosts(
		body.Uin,
		body.Status,
		*body.TimeOrder,
		*body.Page,
		*body.PageSize,
	)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{
		"list":  posts,
		"total": total,
	})
}

func (pr *PostRouter) GetPostInfo(c *gin.Context) {
	uin, err := pr.Auth(c, Both)

	if err != nil {
		return
	}

	// 检查用户权限
	if !pr.PostService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
		database.USER_GROUP_MEMBER,
	}) {
		pr.StatusCode(c, 401, "权限不足")
		return
	}

	id := c.Param("id")

	idInt, err := strconv.Atoi(id)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	post, err := pr.PostService.GetPost(idInt)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	postInfo := &PostInfo{
		PostPO:    *post,
		TimeStamp: post.CreatedAt.Unix(),
	}

	pr.Success(c, gin.H{
		"post": postInfo,
	})
}

// 取消投稿
func (pr *PostRouter) UserCancelPost(c *gin.Context) {
	// 从jwt取uin
	uin, err := pr.GetUin(c)

	if err != nil {
		pr.StatusCode(c, 401, err.Error())
		return
	}

	// 取body的json里的id
	var body UserCancelPostBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 用户取消投稿
	err = pr.PostService.UserCancelPost(uin, *body.PostID)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{})
}

// 提交稿件审核
func (pr *PostRouter) ReviewPost(c *gin.Context) {
	// 从jwt取uin
	uin, err := pr.Auth(c, Both)

	if err != nil {
		return
	}

	// 检查用户权限
	if !pr.PostService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
		database.USER_GROUP_MEMBER,
	}) {
		pr.StatusCode(c, 401, "权限不足")
		return
	}

	// 取body的json里的id, status, comment
	var body PostReviewBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 提交稿件审核
	err = pr.PostService.PostReview(uin, body.PostID, body.Option, *body.Comment)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{})
}

// 推送稿件日志
func (pr *PostRouter) PostPostLog(c *gin.Context) {

	_, err := pr.Auth(c, ServiceOnly)

	if err != nil {
		return
	}

	// 取body的json里的id, op, old_stat, new_stat, comment
	var body PostLogBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	timeObj := util.GetCSTTime()

	log := database.PostLogPO{
		PostID:    body.PostID,
		Op:        body.Op,
		OldStat:   body.OldStat,
		NewStat:   body.NewStat,
		Comment:   body.Comment,
		CreatedAt: timeObj,
	}

	// 推送稿件日志
	err = pr.PostService.DB.AddPostLog(&log)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{})
}

// 获取稿件日志
func (pr *PostRouter) GetPostLog(c *gin.Context) {

	uin, err := pr.Auth(c, Both)

	if err != nil {
		return
	}

	id := c.Param("id")

	idInt, err := strconv.Atoi(id)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 获取稿件日志
	logs, err := pr.PostService.GetPostLogs(uin, idInt)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{
		"list": logs,
	})
}

// 提交稿件发布详细信息
func (pr *PostRouter) SubmitPostVerbose(c *gin.Context) {
	_, err := pr.Auth(c, ServiceOnly)

	if err != nil {
		return
	}

	// 取body的json里的id, op, old_stat, new_stat, comment
	var body PostVerboseBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	var postVerbose database.PostVerbose

	postVerbose.PostID = body.PostID
	postVerbose.Key = body.Key
	postVerbose.Values = body.Values
	postVerbose.CreatedAt = util.GetCSTTime()

	// 提交稿件发布详细信息
	err = pr.PostService.SubmitPostVerbose(&postVerbose)

	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	pr.Success(c, gin.H{})
}
