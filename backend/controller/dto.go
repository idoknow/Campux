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
