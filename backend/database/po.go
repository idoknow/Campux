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
	Uin       int64     `json:"uin" bson:"uin"`               // QQ号
	Pwd       string    `json:"pwd" bson:"pwd"`               // 数据库存md5之后的密码
	CreatedAt time.Time `json:"created_at" bson:"created_at"` // CST时间
	UserGroup UserGroup `json:"user_group" bson:"user_group"` // 用户组
	Salt      string    `json:"salt" bson:"salt"`             // 加盐
}

type PostPO struct {
	ID     int      `json:"id" bson:"id"`         // 稿件ID
	UUID   string   `json:"uuid" bson:"uuid"`     // UUID
	Uin    int64    `json:"uin" bson:"uin"`       // 作者QQ号
	Text   string   `json:"text" bson:"text"`     // 正文
	Images []string `json:"images" bson:"images"` // 图片
	Anon   bool     `json:"anon" bson:"anon"`     // 是否匿名
}
