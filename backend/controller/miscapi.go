package controller

import (
	"github.com/RockChinQ/Campux/backend/database"
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
	group.PUT("/set-metadata", mr.SetMetadata)

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

// 设置元数据
func (mr *MiscRouter) SetMetadata(c *gin.Context) {
	uin, err := mr.Auth(c, Both)

	if err != nil {
		return
	}

	// 检查用户权限
	if !mr.MiscService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
		database.USER_GROUP_MEMBER,
	}) {
		mr.StatusCode(c, 401, "权限不足")
		return
	}

	var body SetMetadataBody

	if err := c.ShouldBindJSON(&body); err != nil {
		mr.Fail(c, 1, err.Error())
		return
	}

	key := body.Key
	value := body.Value

	err = mr.MiscService.SetMetadata(key, value)

	if err != nil {
		mr.Fail(c, 1, err.Error())
		return
	}

	mr.Success(c, nil)
}
