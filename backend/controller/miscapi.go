package controller

import (
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/gin-gonic/gin"
)

type MiscRouter struct {
	APIRouter
	MiscService service.MiscService
}

func NewMiscRouter(rg *gin.RouterGroup, ms service.MiscService) *MiscRouter {
	mr := &MiscRouter{
		MiscService: ms,
	}

	group := rg.Group("/misc")

	// bind routes
	group.GET("/get-metadata", mr.GetMetadata)

	return mr
}

// 获取元数据
func (mr *MiscRouter) GetMetadata(c *gin.Context) {
	key := c.Query("key")

	if key == "" {
		mr.Fail(c, 1, "key is required")
		return
	}

	value, err := mr.MiscService.GetMetadata(key)

	if err != nil {
		mr.Fail(c, 1, err.Error())
		return
	}

	mr.Success(c, gin.H{
		"value": value,
	})
}
