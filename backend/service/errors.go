package service

import "errors"

// 账户已存在
var ErrAccountAlreadyExist = errors.New("此账户已存在")

// 无此账户
var ErrAccountNotFound = errors.New("无此账户")

// 密码错误
var ErrPasswordIncorrect = errors.New("密码错误")

// 不允许的图片后缀
var ErrInvalidImageSuffix = errors.New("不允许的图片后缀")

// OAuth2应用名称已存在
var ErrOAuth2AppAlreadyExist = errors.New("OAuth2应用名称已存在")
