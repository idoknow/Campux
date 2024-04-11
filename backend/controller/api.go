package controller

import (
	"github.com/RockChinQ/Campux/backend/service"
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
