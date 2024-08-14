package service

import (
	"errors"
	"time"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/util"
)

type AccountService struct {
	CommonService
	DB database.MongoDBManager
}

func NewAccountService(db database.MongoDBManager) *AccountService {
	return &AccountService{
		CommonService: CommonService{
			DB: db,
		},
		DB: db,
	}
}

func (as *AccountService) CreateAccount(uin int64) (string, error) {

	// 检查是否存在相同的uin
	acc, err := as.DB.GetAccountByUIN(uin)
	if err != nil {
		return "", err
	}

	if acc != nil {
		return "", ErrAccountAlreadyExist
	} else {
		initPwd := util.GenerateRandomPassword()

		var pwdHash string
		pwdHash, err = util.CreateHash(initPwd, util.DefaultParams)
		if err != nil {
			return "", err
		}
		acc := &database.AccountPO{
			Uin:       uin,
			Pwd:       pwdHash,
			UserGroup: database.USER_GROUP_USER,
			CreatedAt: util.GetCSTTime(),
		}

		err := as.DB.AddAccount(acc)

		return initPwd, err
	}
}

// 检查账户, 返回jwt token
func (as *AccountService) CheckAccount(uin int64, pwd string) (string, error) {
	acc, err := as.DB.GetAccountByUIN(uin)
	if err != nil {
		return "", err
	}

	if acc == nil {
		return "", ErrAccountNotFound
	}

	var valid bool
	valid, err = util.ComparePasswordAndHash(pwd, acc.Pwd)
	if err != nil {
		if err == util.ErrInvalidHash {
			return "", errors.New("hash 算法已更改，请重置密码")
		}

		return "", err
	}

	if !valid {
		return "", ErrPasswordIncorrect
	}

	jwt, err := util.GenerateUserJWTToken(uin)

	return jwt, err
}

// 重置密码
func (as *AccountService) ResetPassword(uin int64) (string, error) {
	acc, err := as.DB.GetAccountByUIN(uin)

	if err != nil {
		return "", err
	}

	if acc == nil {
		return "", ErrAccountNotFound
	}

	// 生成新密码
	newPwd := util.GenerateRandomPassword()

	var encryptedPwd string

	encryptedPwd, err = util.CreateHash(newPwd, util.DefaultParams)
	if err != nil {
		return "", err
	}

	// 更新密码
	err = as.DB.UpdatePassword(uin, encryptedPwd)

	return newPwd, err
}

// 修改密码
func (as *AccountService) ChangePassword(uin int64, newPwd string) error {
	acc, err := as.DB.GetAccountByUIN(uin)

	if err != nil {
		return err
	}

	if acc == nil {
		return ErrAccountNotFound
	}

	var encryptedPwd string
	encryptedPwd, err = util.CreateHash(newPwd, util.DefaultParams)
	if err != nil {
		return err
	}

	// 更新密码
	err = as.DB.UpdatePassword(uin, encryptedPwd)

	return err
}

// 获取账号列表
func (as *AccountService) GetAccounts(
	uin int64,
	userGroup database.UserGroup,
	timeOrder int,
	page, pageSize int,
) ([]database.AccountExpose, int, error) {
	return as.DB.GetAccounts(uin, userGroup, timeOrder, page, pageSize)
}

// 封禁账户
func (as *AccountService) BanAccount(
	uin int64,
	op int64,
	comment string,
	endTime time.Time,
) error {
	acc, err := as.DB.GetAccountByUIN(uin)

	if err != nil {
		return err
	}

	if acc == nil {
		return ErrAccountNotFound
	}

	if acc.UserGroup == database.USER_GROUP_ADMIN {
		return errors.New("不允许封禁管理员账户")
	}

	// 封禁
	banInfo := database.BanInfo{
		Uin:       uin,
		Op:        op,
		StartTime: util.GetCSTTime(),
		Comment:   comment,
		EndTime:   endTime,
	}

	err = as.DB.BanAccount(banInfo)

	return err
}

// 解封账户
func (as *AccountService) UnbanAccount(uin int64) error {
	acc, err := as.DB.GetAccountByUIN(uin)

	if err != nil {
		return err
	}

	if acc == nil {
		return ErrAccountNotFound
	}

	// 解封
	err = as.DB.UnbanAccount(uin)

	return err
}

// 更改用户组
func (as *AccountService) ChangeUserGroup(uin int64, userGroup database.UserGroup) error {
	acc, err := as.DB.GetAccountByUIN(uin)

	if err != nil {
		return err
	}

	if acc == nil {
		return ErrAccountNotFound
	}

	// 更新用户组
	err = as.DB.UpdateUserGroup(uin, userGroup)

	return err
}

// 获取封禁记录
func (as *AccountService) GetBanList(
	uin int64,
	onlyValid bool,
	timeOrder int,
	page, pageSize int,
) ([]database.BanInfo, int, error) {
	return as.DB.GetBanList(uin, onlyValid, timeOrder, page, pageSize)
}
