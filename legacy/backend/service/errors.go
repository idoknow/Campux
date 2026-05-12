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

// OAuth2认证 Secret 不匹配
var ErrOAuth2SecretNotMatch = errors.New("OAuth2 认证 Secret 不匹配")

// 无效的 OAuth2 Access Token
var ErrInvalidOAuth2AccessToken = errors.New("无效的 OAuth2 Access Token")
