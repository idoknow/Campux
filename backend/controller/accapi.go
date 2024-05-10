package controller

import (
	"net/http"

	"github.com/RockChinQ/Campux/backend/service"
	"github.com/gin-gonic/gin"
)

type AccountRouter struct {
	APIRouter
	AccountService service.AccountService
}

func NewAccountRouter(rg *gin.RouterGroup, as service.AccountService) *AccountRouter {
	ar := &AccountRouter{
		AccountService: as,
	}

	group := rg.Group("/account")

	// bind routes
	group.POST("/create", ar.CreateAccount)
	group.POST("/login", ar.LoginAccount)
	group.PUT("/reset", ar.ResetPassword)
	group.PUT("/update-pwd", ar.ChangePassword)
	group.GET("/token-check", ar.CheckToken)

	return ar
}

// 创建账户
func (ar *AccountRouter) CreateAccount(c *gin.Context) {

	_, err := ar.Auth(c, ServiceOnly)

	if err != nil {
		ar.StatusCode(c, 401, err.Error())
		return
	}

	// 取body的json里的uin
	var body AccountCreateBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	// 创建账户
	pwd, err := ar.AccountService.CreateAccount(body.Uin)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, gin.H{
		"passwd": pwd,
	})
}

// 登录
func (ar *AccountRouter) LoginAccount(c *gin.Context) {
	// 取body的json里的uin和pwd
	var body AccountLoginBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	// 检查账户
	token, err := ar.AccountService.CheckAccount(body.Uin, body.Passwd)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	domain := c.Request.Header.Get("Origin")

	// set-cookie
	// 要求：
	// 1. 调试模式时允许跨域
	// 2. 设置的域为请求的域
	// 3. 允许js修改
	if gin.Mode() == gin.DebugMode {
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     "access-token",
			Value:    token,
			Path:     "/",
			Domain:   domain,
			Secure:   false,
			SameSite: http.SameSiteLaxMode,
			HttpOnly: false,
			MaxAge:   3600,
		})
	} else {
		// 正式环境用strict模式
		http.SetCookie(c.Writer, &http.Cookie{
			Name:     "access-token",
			Value:    token,
			Path:     "/",
			Domain:   domain,
			Secure:   false,
			SameSite: http.SameSiteStrictMode,
			HttpOnly: false,
			MaxAge:   3600,
		})
	}

	ar.Success(c, gin.H{
		"token": token,
	})
}

// 重置密码
func (ar *AccountRouter) ResetPassword(c *gin.Context) {

	_, err := ar.Auth(c, ServiceOnly)

	if err != nil {
		ar.StatusCode(c, 401, err.Error())
		return
	}

	// 取body的json里的uin
	var body AccountCreateBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	// 重置密码
	pwd, err := ar.AccountService.ResetPassword(body.Uin)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, gin.H{
		"passwd": pwd,
	})
}

// 修改密码
func (ar *AccountRouter) ChangePassword(c *gin.Context) {
	uin, err := ar.GetUin(c)

	if err != nil {
		ar.StatusCode(c, 401, err.Error())
		return
	}

	// 取body的json里的uin和pwd
	var body AccountChangePasswordBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	// 修改密码
	err = ar.AccountService.ChangePassword(uin, body.NewPasswd)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, nil)
}

// 检查token
func (ar *AccountRouter) CheckToken(c *gin.Context) {
	uin, err := ar.GetUin(c)

	if err != nil {
		ar.StatusCode(c, 401, err.Error())
		return
	}

	acc, err := ar.AccountService.DB.GetAccountByUIN(uin)

	if err != nil {
		ar.StatusCode(c, 500, err.Error())
		return
	}

	if acc == nil {
		ar.StatusCode(c, 401, service.ErrAccountNotFound.Error())
		return
	}

	ar.Success(c, gin.H{
		"uin":        uin,
		"user_group": acc.UserGroup,
	})
}
