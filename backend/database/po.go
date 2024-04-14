package database

import (
	"time"
)

type UserGroup string

const (
	USER_GROUP_ANY    UserGroup = "any"
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

type PostStatus string

const (
	POST_STATUS_ANY              PostStatus = "any"              // 任何
	POST_STATUS_PENDING_APPROVAL PostStatus = "pending_approval" // 待审核
	POST_STATUS_APPROVED         PostStatus = "approved"         // 通过
	POST_STATUS_REJECTED         PostStatus = "rejected"         // 拒绝
	POST_STATUS_CANCELLED        PostStatus = "cancelled"        // 取消
	POST_STATUS_IN_QUEUE         PostStatus = "in_queue"         // 排队
	POST_STATUS_PUBLISHED        PostStatus = "published"        // 已发表
	POST_STATUS_FAILED           PostStatus = "failed"           // 失败
	POST_STATUS_PENDING_RECALL   PostStatus = "pending_recall"   // 待撤回
	POST_STATUS_RECALLED         PostStatus = "recalled"         // 已撤回
)

type PostPO struct {
	ID        int        `json:"id" bson:"id"`                 // 稿件ID
	UUID      string     `json:"uuid" bson:"uuid"`             // UUID
	Uin       int64      `json:"uin" bson:"uin"`               // 作者QQ号
	Text      string     `json:"text" bson:"text"`             // 正文
	Images    []string   `json:"images" bson:"images"`         // 图片
	Anon      bool       `json:"anon" bson:"anon"`             // 是否匿名
	Status    PostStatus `json:"status" bson:"status"`         // 状态
	CreatedAt time.Time  `json:"created_at" bson:"created_at"` // CST时间
}

type PostLogPO struct {
	PostID    int        `json:"post_id" bson:"post_id"`       // 稿件ID
	Op        int64      `json:"op" bson:"op"`                 // 操作者ID -1表示系统
	OldStat   PostStatus `json:"old_stat" bson:"old_stat"`     // 旧状态
	NewStat   PostStatus `json:"new_stat" bson:"new_stat"`     // 新状态
	Comment   string     `json:"comment" bson:"comment"`       // 备注
	CreatedAt time.Time  `json:"created_at" bson:"created_at"` // CST时间
}
