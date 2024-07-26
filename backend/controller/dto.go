package controller

import (
	"github.com/RockChinQ/Campux/backend/database"
)

type AccountCreateBody struct {
	// Uin 账户的uin 必须
	Uin int64 `json:"uin" binding:"required"`
}

type AccountLoginBody struct {
	// Uin 账户的uin 必须
	Uin int64 `json:"uin" binding:"required"`

	// Pwd 账户的密码 必须
	Passwd string `json:"passwd" binding:"required"`
}

type AccountChangePasswordBody struct {
	// 新密码
	NewPasswd string `json:"new_passwd" binding:"required"`
}

type GetAccountsBody struct {
	// uin
	Uin int64 `json:"uin" binding:"required"`

	// 用户组
	UserGroup database.UserGroup `json:"user_group" binding:"required"`

	// time_order
	TimeOrder *int `json:"time_order" binding:"required"`

	// page
	Page *int `json:"page" binding:"required"`

	// page_size
	PageSize *int `json:"page_size" binding:"required"`
}

type AccountBanBody struct {
	// 被封禁的uin
	Uin int64 `json:"uin" binding:"required"`

	// 封禁原因
	Comment string `json:"comment" binding:"required"`

	// 结束时间
	EndTime int64 `json:"end_time" binding:"required"`
}

type AccountUnbanBody struct {
	// 被封禁的uin
	Uin int64 `json:"uin" binding:"required"`
}

type ChangeUserGroupBody struct {
	// 被操作的uin
	Uin int64 `json:"uin" binding:"required"`

	// 新的用户组
	NewGroup database.UserGroup `json:"new_group" binding:"required"`
}

type PostNewBody struct {

	// UUID UUID 必须
	UUID string `json:"uuid" binding:"required"`

	// Text 正文 必须
	Text string `json:"text" binding:"required"`

	// Anon 是否匿名
	Anon *bool `json:"anon" binding:"required"`

	// Images 图片
	Images []string `json:"images"`
}

type GetSelfPostsBody struct {
	// 状态
	Status database.PostStatus `json:"status" binding:"required"`

	// 时间排序
	TimeOrder *int `json:"time_order" binding:"required"`

	// 页码
	Page *int `json:"page" binding:"required"`

	// 每页数量
	PageSize *int `json:"page_size" binding:"required"`
}

type GetPostsBody struct {
	// uin
	Uin int64 `json:"uin" binding:"required"`

	GetSelfPostsBody
}

type UserCancelPostBody struct {
	PostID *int `json:"post_id" binding:"required"`
}

// 稿件审核
type PostReviewBody struct {
	// 稿件id
	PostID int `json:"post_id" binding:"required"`

	// 审核选项
	Option database.ReviewOption `json:"option" binding:"required"`

	// 审核意见
	Comment *string `json:"comment" binding:"required"`
}

// 稿件信息响应
type PostInfo struct {
	database.PostPO
	TimeStamp int64 `json:"time_stamp" bson:"time_stamp"` // 时间戳
}

type PostLogBody struct {
	PostID  int                 `json:"post_id" bson:"post_id"`   // 稿件ID
	Op      int64               `json:"op" bson:"op"`             // 操作者ID -1表示系统
	OldStat database.PostStatus `json:"old_stat" bson:"old_stat"` // 旧状态
	NewStat database.PostStatus `json:"new_stat" bson:"new_stat"` // 新状态
	Comment string              `json:"comment" bson:"comment"`   // 备注
}

type PostVerboseBody struct {
	PostID int                    `json:"post_id" binding:"required"`
	Key    string                 `json:"key" binding:"required"`
	Values map[string]interface{} `json:"values" binding:"required"`
}

type GetBanListBody struct {
	// uin
	Uin int64 `json:"uin" binding:"required"`

	// 仅有效的
	OnlyValid *bool `json:"only_valid" binding:"required"`

	// 页码
	Page *int `json:"page" binding:"required"`

	// 每页数量
	PageSize *int `json:"page_size" binding:"required"`

	// 时间排序
	TimeOrder *int `json:"time_order" binding:"required"`
}
