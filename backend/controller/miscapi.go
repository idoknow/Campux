package controller

import (
	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/RockChinQ/Campux/backend/util"
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
	group.GET("/get-metadata-list", mr.GetMetadataList)
	group.PUT("/save-metadatas", mr.SaveMetadata)
	group.GET("/get-version", mr.GetVersion)

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

// 获取元数据列表
func (mr *MiscRouter) GetMetadataList(c *gin.Context) {
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

	list, err := mr.MiscService.GetMetadataList()

	if err != nil {
		mr.Fail(c, 1, err.Error())
		return
	}

	mr.Success(c, gin.H{
		"list": list,
	})
}

// 保存元数据
func (mr *MiscRouter) SaveMetadata(c *gin.Context) {
	uin, err := mr.Auth(c, Both)

	if err != nil {
		return
	}

	// 检查用户权限
	if !mr.MiscService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
	}) {
		mr.StatusCode(c, 401, "权限不足")
		return
	}

	var body SaveMetadataBody

	if err := c.ShouldBindJSON(&body); err != nil {
		mr.Fail(c, 1, err.Error())
		return
	}

	err = mr.MiscService.SaveMetadata(body.MetadataList)

	if err != nil {
		mr.Fail(c, 1, err.Error())
		return
	}

	mr.Success(c, nil)
}

// 获取版本信息
func (mr *MiscRouter) GetVersion(c *gin.Context) {
	mr.Success(c, gin.H{
		"version": util.SEMANTIC_VERSION,
	})
}
