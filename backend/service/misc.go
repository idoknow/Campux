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

func (ms *MiscService) SetMetadata(key, value string) error {
	return ms.DB.SetMetadata(key, value)
}

func (ms *MiscService) GetMetadataList() ([]database.Metadata, error) {

	return ms.DB.GetMetadataList()
}

func (ms *MiscService) SaveMetadata(metadataList []database.Metadata) error {
	for _, metadata := range metadataList {
		err := ms.SetMetadata(metadata.Key, metadata.Value)
		if err != nil {
			return err
		}
	}
	return nil
}
