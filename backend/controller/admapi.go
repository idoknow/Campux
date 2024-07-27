package controller

import (
	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/gin-gonic/gin"
)

type AdminRouter struct {
	APIRouter
	AdminService service.AdminService
}

func NewAdminRouter(rg *gin.RouterGroup, as service.AdminService) *AdminRouter {
	ar := &AdminRouter{
		AdminService: as,
	}

	group := rg.Group("/admin")

	// bind routes
	group.POST("/add-oauth2-app", ar.AddOAuth2App)
	group.GET("/get-oauth2-apps", ar.GetOAuth2AppList)
	group.DELETE("/del-oauth2-app/:id", ar.DeleteOAuth2App)

	return ar
}

// 添加一个OAuth2应用
func (ar *AdminRouter) AddOAuth2App(c *gin.Context) {

	uin, err := ar.Auth(c, UserOnly)

	if err != nil {
		return
	}

	if !ar.AdminService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
	}) {
		ar.StatusCode(c, 401, "权限不足")
		return
	}

	// 取body的json里的appname
	var body OAuth2AppCreateBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	// 创建OAuth2应用
	app, err := ar.AdminService.AddOAuth2App(body.Name, body.Emoji)

	if err != nil {
		ar.Fail(c, 2, err.Error())
		return
	}

	ar.Success(c, app)
}

// 获取 OAuth2 应用列表
func (ar *AdminRouter) GetOAuth2AppList(c *gin.Context) {
	uin, err := ar.Auth(c, UserOnly)

	if err != nil {
		return
	}

	if !ar.AdminService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
	}) {
		ar.StatusCode(c, 401, "权限不足")
		return
	}

	// 获取OAuth2应用列表
	list, err := ar.AdminService.GetOAuth2Apps()

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, gin.H{
		"list": list,
	})
}

// 删除一个OAuth2应用
func (ar *AdminRouter) DeleteOAuth2App(c *gin.Context) {
	uin, err := ar.Auth(c, UserOnly)

	if err != nil {
		return
	}

	if !ar.AdminService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
	}) {
		ar.StatusCode(c, 401, "权限不足")
		return
	}

	// 取路由参数
	appID := c.Param("id")

	// 删除OAuth2应用
	err = ar.AdminService.DeleteOAuth2App(appID)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, nil)
}
