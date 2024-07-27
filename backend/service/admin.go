package service

import (
	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/util"
	"github.com/google/uuid"
)

type AdminService struct {
	CommonService
}

func NewAdminService(db database.MongoDBManager) *AdminService {
	return &AdminService{
		CommonService: CommonService{
			DB: db,
		},
	}
}

func (as *AdminService) AddOAuth2App(name, emoji string) (*database.OAuthAppPO, error) {
	check, err := as.DB.GetOAuth2AppByName(name)

	if err != nil {
		return nil, err
	}

	if check != nil {
		return nil, ErrOAuth2AppAlreadyExist
	}

	app := &database.OAuthAppPO{
		Name:         name,
		Emoji:        emoji,
		ClientID:     util.RandomString(16),
		ClientSecret: uuid.New().String(),
		CreatedAt:    util.GetCSTTime(),
	}

	err = as.DB.AddOAuth2App(app)

	return app, err
}

func (as *AdminService) GetOAuth2Apps() ([]database.OAuthAppPO, error) {
	return as.DB.GetOAuth2Apps()
}

// delete
func (as *AdminService) DeleteOAuth2App(appID string) error {
	return as.DB.DeleteOAuth2App(appID)
}
