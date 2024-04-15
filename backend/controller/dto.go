package controller

import "github.com/RockChinQ/Campux/backend/database"

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
