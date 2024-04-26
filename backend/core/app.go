package core

import (
	"time"

	"github.com/RockChinQ/Campux/backend/controller"
	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/mq"
	"github.com/RockChinQ/Campux/backend/oss"
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/RockChinQ/Campux/backend/service/routine"
	gocron "github.com/go-co-op/gocron/v2"
)

type Application struct {
	API *controller.APIController
}

func NewApplication() *Application {

	db := database.NewMongoDBManager()
	fs := oss.NewMinioClient()
	msq := mq.NewRedisStreamMQ()

	as := service.NewAccountService(*db)
	ps := service.NewPostService(*db, *fs, *msq)
	ms := service.NewMiscService(*db)

	err := ScheduleRoutines(*db, *msq)
	if err != nil {
		panic(err)
	}

	return &Application{
		API: controller.NewApiController(*as, *ps, *ms),
	}
}

func ScheduleRoutines(
	db database.MongoDBManager,
	msq mq.RedisStreamMQ,
) error {
	s, err := gocron.NewScheduler()
	if err != nil {
		return err
	}

	_, err = s.NewJob(
		gocron.DurationJob(
			20*time.Second,
		),
		gocron.NewTask(
			routine.SchedulePublishing,
			db,
			msq,
		),
	)
	if err != nil {
		return err
	}

	s.Start()

	return nil
}

func (a *Application) Run() {
	a.API.R.Run()
}
