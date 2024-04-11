package controller

import (
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

	return pr
}

// 上传图片
func (pr *PostRouter) UploadImage(c *gin.Context) {
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
