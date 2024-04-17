package service

import "github.com/RockChinQ/Campux/backend/database"

type MiscService struct {
	DB database.MongoDBManager
}

func NewMiscService(db database.MongoDBManager) *MiscService {
	return &MiscService{
		DB: db,
	}
}

func (ms *MiscService) GetMetadata(key string) (string, error) {
	return ms.DB.GetMetadata(key)
}
