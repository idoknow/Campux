package controller

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
