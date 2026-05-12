package service

import "github.com/RockChinQ/Campux/backend/database"

type CommonService struct {
	DB database.BaseDBManager
}

func (cs *CommonService) CheckUserGroup(uin int64, groups []database.UserGroup) bool {

	if uin == 0 {
		return true
	}

	acc, err := cs.DB.GetAccountByUIN(uin)
	if err != nil {
		return false
	}

	if acc == nil {
		return false
	}

	for _, group := range groups {
		if acc.UserGroup == group {
			return true
		}
	}

	return false
}
