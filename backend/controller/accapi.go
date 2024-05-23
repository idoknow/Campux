package controller

import (
	"net/http"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/RockChinQ/Campux/backend/util"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
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

	group.POST("/get-accounts", ar.GetAccountList)
	group.POST("/ban-account", ar.BanAccount)
	group.PUT("/unban-account", ar.UnbanAccount)
	group.PUT("/change-group", ar.ChangeUserGroup)

	return ar
}

// 创建账户
func (ar *AccountRouter) CreateAccount(c *gin.Context) {

	_, err := ar.Auth(c, ServiceOnly)

	if err != nil {
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
			MaxAge:   viper.GetInt("auth.jwt.expire"),
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
			MaxAge:   viper.GetInt("auth.jwt.expire"),
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

	// 判断是否被封禁
	crtTime := util.GetCSTTime()

	bannedInfo, err := ar.AccountService.DB.GetCurrentBanInfo(uin)

	if err != nil {
		ar.StatusCode(c, 500, err.Error())
		return
	}

	access := gin.H{}

	if bannedInfo != nil && bannedInfo.EndTime.After(crtTime) {
		access["is_banned"] = true
		access["end_time"] = bannedInfo.EndTime
		access["comment"] = bannedInfo.Comment
	} else {
		access["is_banned"] = false
	}

	ar.Success(c, gin.H{
		"uin":        uin,
		"user_group": acc.UserGroup,
		"access":     access,
	})
}

// 获取账号列表
func (ar *AccountRouter) GetAccountList(c *gin.Context) {
	uin, err := ar.Auth(c, Both)

	if err != nil {
		return
	}

	// 检查用户权限
	if !ar.AccountService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
		database.USER_GROUP_MEMBER,
	}) {
		ar.StatusCode(c, 401, "权限不足")
		return
	}

	var body GetAccountsBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	accounts, total, err := ar.AccountService.GetAccounts(body.Uin, body.UserGroup, *body.TimeOrder, *body.Page, *body.PageSize)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, gin.H{
		"list":  accounts,
		"total": total,
	})
}

// 封禁用户
func (ar *AccountRouter) BanAccount(c *gin.Context) {
	uin, err := ar.Auth(c, UserOnly)

	if err != nil {
		return
	}

	if !ar.AccountService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
		database.USER_GROUP_MEMBER,
	}) {
		ar.StatusCode(c, 401, "权限不足")
		return
	}

	var body AccountBanBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	// 封禁
	err = ar.AccountService.BanAccount(body.Uin, uin, body.Comment, util.GetCSTTimeFromUnix(body.EndTime))

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, nil)
}

// 解封用户
func (ar *AccountRouter) UnbanAccount(c *gin.Context) {
	uin, err := ar.Auth(c, UserOnly)

	if err != nil {
		return
	}

	if !ar.AccountService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
		database.USER_GROUP_MEMBER,
	}) {
		ar.StatusCode(c, 401, "权限不足")
		return
	}

	var body AccountUnbanBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	// 解封
	err = ar.AccountService.UnbanAccount(body.Uin)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, nil)
}

// 更改用户组
func (ar *AccountRouter) ChangeUserGroup(c *gin.Context) {
	uin, err := ar.Auth(c, UserOnly)

	if err != nil {
		return
	}

	if !ar.AccountService.CheckUserGroup(uin, []database.UserGroup{
		database.USER_GROUP_ADMIN,
	}) {
		ar.StatusCode(c, 401, "权限不足")
		return
	}

	var body ChangeUserGroupBody

	if err := c.ShouldBindJSON(&body); err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	if body.Uin == uin {
		ar.Fail(c, 1, "不允许更改自己的用户组")
		return
	}

	// 更新用户组
	err = ar.AccountService.ChangeUserGroup(body.Uin, body.NewGroup)

	if err != nil {
		ar.Fail(c, 1, err.Error())
		return
	}

	ar.Success(c, nil)
}
