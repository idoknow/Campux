package service

import (
	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/util"
)

type AccountService struct {
	DB database.MongoDBManager
}

func NewAccountService(db database.MongoDBManager) *AccountService {
	return &AccountService{
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
		salt := util.GenerateRandomSalt()

		acc := &database.AccountPO{
			Uin:       uin,
			Pwd:       util.EncryptPassword(initPwd, salt),
			UserGroup: database.USER_GROUP_USER,
			Salt:      salt,
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

	valid := acc.Pwd == util.EncryptPassword(pwd, acc.Salt)

	if !valid {
		return "", ErrPasswordIncorrect
	}

	// TODO: generate jwt token
	jwt, err := util.GenerateJWTToken(uin)

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
	salt := util.GenerateRandomSalt()

	encryptedPwd := util.EncryptPassword(newPwd, salt)

	// 更新密码
	err = as.DB.UpdatePassword(uin, encryptedPwd, salt)

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

	salt := util.GenerateRandomSalt()

	encryptedPwd := util.EncryptPassword(newPwd, salt)

	// 更新密码
	err = as.DB.UpdatePassword(uin, encryptedPwd, salt)

	return err
}
