package controller

import (
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/RockChinQ/Campux/backend/util"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

type APIController struct {
	R *gin.Engine
}

func NewApiController(
	as service.AccountService,
	ps service.PostService,
) *APIController {
	r := gin.Default()

	if gin.Mode() == gin.DebugMode {
		r.Use(cors.Default())
	}

	rg := r.Group("/v1")

	// bind routes
	NewAccountRouter(rg, as)
	NewPostRouter(rg, ps)

	return &APIController{
		R: r,
	}
}

type APIRouter struct {
}

// 从jwt取uin
func (ar *APIRouter) GetUin(c *gin.Context) (int64, error) {
	jwtToken := c.GetHeader("Authorization")

	// 删除Bearer
	jwtToken = jwtToken[7:]

	uin, err := util.ParseJWTToken(jwtToken)

	return uin, err
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
