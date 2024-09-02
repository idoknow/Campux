package controller

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/RockChinQ/Campux/backend/service"
	"github.com/RockChinQ/Campux/backend/util"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
)

type APIController struct {
	R *gin.Engine
}

func NewApiController(
	as service.AccountService,
	ps service.PostService,
	ms service.MiscService,
	ads service.AdminService,
	oas service.OAuth2Service,
) *APIController {
	r := gin.Default()

	if gin.Mode() == gin.DebugMode {
		r.Use(
			cors.New(
				cors.Config{
					AllowOrigins: []string{
						"http://localhost:3000",
						"http://localhost:3001",
						"http://127.0.0.1:3000",
						"http://127.0.0.1:3001",
					},
					AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"},
					AllowHeaders:     []string{"Origin", "Content-Length", "Content-Type", "Authorization", "Cookie"},
					ExposeHeaders:    []string{"Content-Length", "Content-Type"},
					AllowCredentials: true,
					MaxAge:           12 * time.Hour,
				},
			),
		)
	}

	// 鉴权中间件

	r.Use(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/v1") {
			c.Next()
			return
		}
		// 没有文件都返回/
		if !util.IsFileExist("./frontend/dist" + c.Request.URL.Path) {
			http.ServeFile(c.Writer, c.Request, "./frontend/dist/index.html")
		} else {
			http.ServeFile(c.Writer, c.Request, "./frontend/dist"+c.Request.URL.Path)
		}
	})

	rg := r.Group("/v1")

	// bind routes
	NewAccountRouter(rg, as)
	NewPostRouter(rg, ps, as)
	NewMiscRouter(rg, ms)
	NewAdminRouter(rg, ads, as)
	NewOAuth2Router(rg, oas)

	return &APIController{
		R: r,
	}
}

type APIRouter struct {
}

type AuthenticationType int

const (
	UserOnly    AuthenticationType = 1
	ServiceOnly AuthenticationType = 2
	Both        AuthenticationType = 3
)

var ErrAccountBanned = errors.New("账户已被封禁")

func (ar *APIRouter) GetBearerToken(c *gin.Context) (string, error) {
	bearer := c.GetHeader("Authorization")
	if bearer == "" {
		return "", errors.New("no bearer token")
	}

	return bearer[7:], nil
}

// 鉴权
// 如果是服务鉴权，则拿Authorization头对比service.token
// 其他的都是用户鉴权，直接尝试从GetUin取uin
func (ar *APIRouter) Auth(c *gin.Context, authType AuthenticationType) (int64, error) {
	serviceToken := viper.GetString("service.token")

	uin, err := int64(-1), errors.New("authentication failed")

	if authType&ServiceOnly == ServiceOnly {
		bearer := c.GetHeader("Authorization")
		if bearer != "" {
			bearer = bearer[7:]

			if bearer == serviceToken {
				uin = 0
				err = nil
			}
		}
	}

	if err == nil {
		return uin, err
	}

	if authType&UserOnly == UserOnly {
		uin, err = ar.GetUin(c)
	}

	if err == nil {
		return uin, err
	} else {
		ar.StatusCode(c, 401, err.Error())
		return -1, err
	}
}

// 检查当前用户是否被封禁
func (ar *APIRouter) CheckIfBanned(c *gin.Context, as service.AccountService, uin int64) bool {
	if uin == 0 {
		return false
	}

	acc, err := as.DB.GetAccountByUIN(uin)

	if err != nil {
		ar.StatusCode(c, 500, err.Error())
		return true
	}

	if acc == nil {
		ar.StatusCode(c, 401, service.ErrAccountNotFound.Error())
		return true
	}

	// 判断是否被封禁
	crtTime := util.GetCSTTime()

	bannedInfo, err := as.DB.GetCurrentBanInfo(uin)

	if err != nil {
		ar.StatusCode(c, 500, err.Error())
		return true
	}

	if bannedInfo != nil && bannedInfo.EndTime.After(crtTime) {
		ar.StatusCode(c, 403, ErrAccountBanned.Error())
		return true
	}

	return false
}

// 从jwt取uin
func (ar *APIRouter) GetUin(c *gin.Context) (int64, error) {

	// 尝试从header取jwt token
	if c.GetHeader("Authorization") != "" {

		jwtToken := c.GetHeader("Authorization")

		// 删除Bearer
		jwtToken = jwtToken[7:]

		uin, err := util.ParseUserJWTToken(jwtToken)

		return uin, err
	} else {
		// 尝试从cookies取jwt token
		jwtToken, err := c.Cookie("access-token")

		if err != nil {
			return -1, err
		}

		uin, err := util.ParseUserJWTToken(jwtToken)

		return uin, err
	}
}

func (ar *APIRouter) Success(c *gin.Context, data interface{}) {
	c.JSON(200, gin.H{
		"code": 0,
		"msg":  "ok",
		"data": data,
	})
}

func (ar *APIRouter) Fail(c *gin.Context, code int, msg string) {
	c.JSON(200, gin.H{
		"code": code,
		"msg":  msg,
		"data": gin.H{},
	})
}

func (ar *APIRouter) StatusCode(c *gin.Context, code int, msg string) {
	c.JSON(code, gin.H{
		"code": -1,
		"msg":  msg,
		"data": gin.H{},
	})
}
