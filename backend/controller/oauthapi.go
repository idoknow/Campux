package controller

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/RockChinQ/Campux/backend/service"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
	"github.com/spf13/viper"
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
	group.POST("/token", oar.GetAccessTokenByOAuth2Spec)
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

func (oar *OAuth2Router) GetAccessTokenByOAuth2Spec(c *gin.Context) {
	var body OAuth2TokenBody

	if err := c.ShouldBind(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             "invalid_request",
			"error_description": "invalid request parameters",
		})
		return
	}

	clientID, clientSecret, hasBasicAuth, err := parseOAuth2ClientCredentials(c)
	if err != nil {
		writeOAuth2InvalidClient(c)
		return
	}

	if hasBasicAuth {
		if (body.ClientID != "" && body.ClientID != clientID) || (body.ClientSecret != "" && body.ClientSecret != clientSecret) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":             "invalid_request",
				"error_description": "conflicting client credentials",
			})
			return
		}
	} else {
		clientID = body.ClientID
		clientSecret = body.ClientSecret
	}

	if clientID == "" || clientSecret == "" {
		writeOAuth2InvalidClient(c)
		return
	}

	if body.GrantType != "authorization_code" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             "unsupported_grant_type",
			"error_description": "grant_type must be authorization_code",
		})
		return
	}

	ak, err := oar.OAuth2Service.GetAccessToken(clientID, clientSecret, body.Code)

	if err != nil {
		if err == service.ErrOAuth2SecretNotMatch {
			writeOAuth2InvalidClient(c)
			return
		}

		if isOAuth2InvalidGrantError(err) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":             "invalid_grant",
				"error_description": "invalid authorization code",
			})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{
			"error":             "server_error",
			"error_description": "internal server error",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": ak,
		"token_type":   "Bearer",
		"expires_in":   viper.GetInt("oauth2.server.ak_expire"),
	})
}

func writeOAuth2InvalidClient(c *gin.Context) {
	c.Header("WWW-Authenticate", "Basic realm=\"oauth2\", error=\"invalid_client\"")
	c.JSON(http.StatusUnauthorized, gin.H{
		"error":             "invalid_client",
		"error_description": "invalid client authentication",
	})
}

func parseOAuth2ClientCredentials(c *gin.Context) (string, string, bool, error) {
	authorization := c.GetHeader("Authorization")

	if authorization == "" {
		return "", "", false, nil
	}

	parts := strings.SplitN(authorization, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Basic") {
		return "", "", true, errors.New("invalid authorization header")
	}

	decoded, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", true, err
	}

	credentials := strings.SplitN(string(decoded), ":", 2)
	if len(credentials) != 2 {
		return "", "", true, errors.New("invalid basic credentials")
	}

	if credentials[0] == "" || credentials[1] == "" {
		return "", "", true, errors.New("invalid basic credentials")
	}

	return credentials[0], credentials[1], true, nil
}

func isOAuth2InvalidGrantError(err error) bool {
	return errors.Is(err, redis.Nil) ||
		errors.Is(err, jwt.ErrTokenMalformed) ||
		errors.Is(err, jwt.ErrTokenSignatureInvalid) ||
		errors.Is(err, jwt.ErrTokenRequiredClaimMissing) ||
		errors.Is(err, jwt.ErrTokenInvalidClaims) ||
		errors.Is(err, jwt.ErrTokenExpired) ||
		errors.Is(err, jwt.ErrTokenUsedBeforeIssued) ||
		errors.Is(err, jwt.ErrTokenNotValidYet) ||
		errors.Is(err, jwt.ErrTokenUnverifiable)
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
