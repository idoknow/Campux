package service

import (
	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/mq"
	"github.com/RockChinQ/Campux/backend/util"

	"github.com/google/uuid"
)

type OAuth2Service struct {
	CommonService
	MQ mq.RedisStreamMQ
}

func NewOAuth2Service(db database.MongoDBManager, mq mq.RedisStreamMQ) *OAuth2Service {
	return &OAuth2Service{
		CommonService: CommonService{
			DB: db,
		},
		MQ: mq,
	}
}

func (oas *OAuth2Service) GetOAuth2AppByClientID(clientID string) (*database.OAuthAppPO, error) {
	return oas.DB.GetOAuth2App(clientID)
}

func (oas *OAuth2Service) GenerateCode(clientID string, uin int64) (string, error) {
	codeUUID := uuid.New().String()

	err := oas.MQ.SetOauth2Code(codeUUID, uin)

	if err != nil {
		return "", err
	}

	return util.GenerateOAuth2CodeJWTToken(codeUUID, clientID)
}

func (oas *OAuth2Service) GetAccessToken(clientID, clientSecret, code string) (string, error) {
	codeUUID, err := util.ParseOAuth2CodeJWTToken(code, clientID)

	if err != nil {
		return "", err
	}
	// 检查secret
	app, err := oas.DB.GetOAuth2App(clientID)

	if err != nil {
		return "", err
	}

	if app.ClientSecret != clientSecret {
		return "", ErrOAuth2SecretNotMatch
	}

	uin, err := oas.MQ.GetOauth2Uin(codeUUID)

	if err != nil {
		return "", err
	}

	accessToken, err := util.GenerateOAuth2AccessTokenJWTToken(uin, clientID)

	return accessToken, err
}
