package controller

import (
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/gin-gonic/gin"
)

type OAuth2Router struct {
	APIRouter
	OAuth2Service service.OAuth2Service
}

func NewOAuth2Router(rg *gin.RouterGroup, oas service.OAuth2Service) *OAuth2Router {

	oar := &OAuth2Router{
		OAuth2Service: oas,
	}

	group := rg.Group("/oauth2")

	group.GET("/get-app-info", oar.GetOAuth2AppInfo)
	group.GET("/authorize", oar.Authorize)
	group.POST("/get-access-token", oar.GetAccessToken)
	group.GET("/get-user-info", oar.GetUserInfo)

	return oar
}

func (oar *OAuth2Router) GetOAuth2AppInfo(c *gin.Context) {
	clientID := c.Query("client_id")

	app, err := oar.OAuth2Service.GetOAuth2AppByClientID(clientID)

	if err != nil {
		oar.Fail(c, 1, err.Error())
		return
	}

	if app == nil {
		oar.Fail(c, 2, "此应用未注册")
		return
	}

	oar.Success(c, gin.H{
		"client_id": app.ClientID,
		"name":      app.Name,
	})
}

func (oar *OAuth2Router) Authorize(c *gin.Context) {

	uin, err := oar.Auth(c, UserOnly)

	if err != nil {
		return
	}

	clientID := c.Query("client_id")

	if clientID == "" {
		oar.Fail(c, 1, "未提供 client_id")
		return
	}

	// 检查是否存在这个应用
	app, err := oar.OAuth2Service.GetOAuth2AppByClientID(clientID)

	if err != nil {
		oar.Fail(c, 2, err.Error())
		return
	}

	if app == nil {
		oar.Fail(c, 3, "此应用未注册")
		return
	}

	// 计算code
	code, err := oar.OAuth2Service.GenerateCode(app.ClientID, uin)

	if err != nil {
		oar.Fail(c, 4, err.Error())
		return
	}

	oar.Success(c, gin.H{
		"code": code,
	})
}

func (oar *OAuth2Router) GetAccessToken(c *gin.Context) {

	var body OAuth2GetAccessTokenBody

	if err := c.ShouldBindJSON(&body); err != nil {
		oar.Fail(c, 1, err.Error())
		return
	}

	// 检查code
	ak, err := oar.OAuth2Service.GetAccessToken(body.ClientID, body.ClientSecret, body.Code)

	if err != nil {
		oar.Fail(c, 2, err.Error())
		return
	}

	oar.Success(c, gin.H{
		"access_token": ak,
	})
}

func (oar *OAuth2Router) GetUserInfo(c *gin.Context) {
	ak, err := oar.GetBearerToken(c)

	if err != nil {
		oar.StatusCode(c, 401, err.Error())
		return
	}

	account, err := oar.OAuth2Service.GetUserInfo(ak)

	if err != nil {
		if err == service.ErrInvalidOAuth2AccessToken {
			oar.StatusCode(c, 401, err.Error())
			return
		} else {
			oar.Fail(c, 1, err.Error())
			return
		}
	}

	oar.Success(c, gin.H{
		"uin":        account.Uin,
		"user_group": account.UserGroup,
		"created_at": account.CreatedAt,
	})
}
