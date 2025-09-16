package controller

import (
	"strconv"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/gin-gonic/gin"
)

type AdminRouter struct {
	APIRouter
	AdminService   service.AdminService
	AccountService service.AccountService
	WebhookService service.WebhookService
}

func NewAdminRouter(rg *gin.RouterGroup, as service.AdminService, acs service.AccountService, ws service.WebhookService) *AdminRouter {
	ar := &AdminRouter{
		AdminService:   as,
		AccountService: acs,
		WebhookService: ws,
	}

	group := rg.Group("/admin")

	// bind routes
	group.POST("/add-oauth2-app", ar.AddOAuth2App)
	group.GET("/get-oauth2-apps", ar.GetOAuth2AppList)
	group.DELETE("/del-oauth2-app/:id", ar.DeleteOAuth2App)
	group.GET("/init", ar.IsInit)
	group.POST("/init", ar.Init)
	group.GET("/get-webhook-config", ar.GetWebhookConfig)
	group.POST("/add-webhook", ar.AddWebhook)
	group.DELETE("/delete-webhook/:id", ar.DeleteWebhook)

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

// 检查是否初始化
func (ar *AdminRouter) IsInit(c *gin.Context) {
	// 检查是否初始化
	init, err := ar.AdminService.IsInit()

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, gin.H{
		"initialized": init,
	})
}

// 初始化
func (ar *AdminRouter) Init(c *gin.Context) {
	// 检查是否初始化
	init, err := ar.AdminService.IsInit()

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	if init {
		ar.Fail(c, 2, "系统已有管理员账户")
		return
	}

	// 取body的json里的appname
	var body InitBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 3, err.Error())
		return
	}

	// 创建管理员账户
	err = ar.AccountService.AddAccount(
		body.AdminUin,
		body.AdminPasswd,
		database.USER_GROUP_ADMIN,
	)

	if err != nil {
		ar.Fail(c, 4, err.Error())
		return
	}

	ar.Success(c, nil)
}

func (ar *AdminRouter) GetWebhookConfig(c *gin.Context) {
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

	webhooks, err := ar.AdminService.GetWebhooks()
	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, gin.H{
		"webhooks": webhooks,
	})
}

func (ar *AdminRouter) AddWebhook(c *gin.Context) {
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

	var body struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	webhook, err := ar.AdminService.AddWebhook(body.Name, body.URL)
	if err != nil {
		ar.Fail(c, 2, err.Error())
		return
	}

	ar.Success(c, webhook)
}

func (ar *AdminRouter) DeleteWebhook(c *gin.Context) {
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

	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		ar.Fail(c, 1, "Invalid webhook ID")
		return
	}

	err = ar.AdminService.DeleteWebhook(id)
	if err != nil {
		ar.Fail(c, 2, err.Error())
		return
	}

	ar.Success(c, nil)
}
