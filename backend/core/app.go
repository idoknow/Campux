package core

import (
	"github.com/RockChinQ/Campux/backend/controller"
	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/oss"
	"github.com/RockChinQ/Campux/backend/service"
)

type Application struct {
	API *controller.APIController
}

func NewApplication() *Application {

	db := database.NewMongoDBManager()
	as := service.NewAccountService(*db)

	fs := oss.NewMinioClient()
	ps := service.NewPostService(*db, *fs)

	return &Application{
		API: controller.NewApiController(*as, *ps),
	}
}

func (a *Application) Run() {
	a.API.R.Run()
}
