package database

import (
	"time"
)

type UserGroup string

const (
	USER_GROUP_ADMIN  UserGroup = "admin"
	USER_GROUP_MEMBER UserGroup = "member"
	USER_GROUP_USER   UserGroup = "user"
)

type AccountPO struct {
	UIN       int64     `json:"uin" bson:"uin"`               // QQ号
	Pwd       string    `json:"pwd" bson:"pwd"`               // 数据库存md5之后的密码
	CreatedAt time.Time `json:"created_at" bson:"created_at"` // CST时间
	UserGroup UserGroup `json:"user_group" bson:"user_group"` // 用户组
	Salt      string    `json:"salt" bson:"salt"`             // 加盐
}
