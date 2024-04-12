package controller

import (
	"bytes"

	"github.com/RockChinQ/Campux/backend/service"
	"github.com/gin-gonic/gin"
)

type PostRouter struct {
	APIRouter
	PostService service.PostService
}

func NewPostRouter(rg *gin.RouterGroup, ps service.PostService) *PostRouter {
	pr := &PostRouter{
		PostService: ps,
	}

	group := rg.Group("/post")

	// bind routes
	group.POST("/upload-image", pr.UploadImage)
	group.POST("/post-new", pr.PostNew)
	// download-image/{image-key}
	group.GET("/download-image/:key", pr.DownloadImage)
	group.POST("/get-self-posts", pr.GetSelfPosts)
	group.POST("/get-posts", pr.GetPosts)

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
	file, _, err := c.Request.FormFile("image")
	if err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	suffix := c.Request.FormValue("suffix")

	// 上传图片
	key, err := pr.PostService.UploadImage(file, suffix)

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
	_, err := pr.GetUin(c)

	if err != nil {
		pr.StatusCode(c, 401, err.Error())
		return
	}

	key := c.Param("key")

	buf := bytes.NewBuffer(nil)

	err = pr.PostService.DownloadImage(key, buf)

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
	posts, err := pr.PostService.GetPosts(
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
		"list": posts,
	})
}

// 获取稿件列表
func (pr *PostRouter) GetPosts(c *gin.Context) {
	var body GetPostsBody

	if err := c.ShouldBindJSON(&body); err != nil {
		pr.Fail(c, 1, err.Error())
		return
	}

	// 获取稿件列表
	posts, err := pr.PostService.GetPosts(
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
		"list": posts,
	})
}
