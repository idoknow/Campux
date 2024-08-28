package core

import (
	"time"

	viper "github.com/spf13/viper"

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

func makeDBManager() database.BaseDBManager {
	switch viper.GetString("database.use") {
	case "mongo":
		return database.NewMongoDBManager()
	case "sqlite":
		return database.NewSQLiteDBManager()
	default:
		return nil
	}
}

func makeOSSProvider() oss.BaseOSSProvider {
	switch viper.GetString("oss.use") {
	case "local":
		return oss.NewLocalStorage()
	case "minio":
		return oss.NewMinioClient()
	default:
		return nil
	}
}

func NewApplication() *Application {

	db := makeDBManager()
	fs := makeOSSProvider()
	msq := mq.NewRedisStreamMQ()

	as := service.NewAccountService(db)
	ps := service.NewPostService(db, fs, *msq)
	ms := service.NewMiscService(db)
	ads := service.NewAdminService(db)
	oas := service.NewOAuth2Service(db, *msq)

	err := ScheduleRoutines(db, *msq)
	if err != nil {
		panic(err)
	}

	return &Application{
		API: controller.NewApiController(*as, *ps, *ms, *ads, *oas),
	}
}

func ScheduleRoutines(
	db database.BaseDBManager,
	msq mq.RedisStreamMQ,
) error {
	s, err := gocron.NewScheduler()
	if err != nil {
		return err
	}

	type Job struct {
		Duration time.Duration
		Task     gocron.Task
	}

	jobs := []Job{
		{
			Duration: 20 * time.Second,
			Task:     gocron.NewTask(routine.SchedulePublishing, db, msq),
		},
		{
			Duration: 20 * time.Second,
			Task:     gocron.NewTask(routine.ConfirmPosted, db, msq),
		},
	}

	for _, job := range jobs {
		_, err = s.NewJob(
			gocron.DurationJob(
				job.Duration,
			),
			job.Task,
		)

		if err != nil {
			return err
		}
	}

	s.Start()

	return nil
}

func (a *Application) Run() {

	a.API.R.Run(
		viper.GetString("backend.host") + ":" + viper.GetString("backend.port"),
	)
}
