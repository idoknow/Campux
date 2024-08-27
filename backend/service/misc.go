package service

import "github.com/RockChinQ/Campux/backend/database"

type MiscService struct {
	CommonService
}

func NewMiscService(db database.BaseDBManager) *MiscService {
	return &MiscService{
		CommonService: CommonService{
			DB: db,
		},
	}
}

func (ms *MiscService) GetMetadata(key string) (string, error) {
	return ms.DB.GetMetadata(key)
}
