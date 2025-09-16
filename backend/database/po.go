package database

import (
	"time"

	"github.com/RockChinQ/Campux/backend/util"
)

type Metadata struct {
	Key string `bson:"key" gorm:"type:varchar(256)" json:"key"`

	Value string `bson:"value" gorm:"type:varchar(2048)" json:"value"`
}

var PresetMetadata = []Metadata{
	{
		Key:   "banner",
		Value: "投稿前请阅读投稿规则！",
	},
	{
		Key:   "popup_announcement",
		Value: "欢迎使用 Campux！",
	},
	{
		Key: "post_rules",
		Value: `[
			"投稿规则是数组",
			"每个元素是一个字符串"
		]`,
	},
	{
		Key: "services",
		Value: `[
			{
				"name": "服务名称",
				"description": "服务也是数组形式，会显示在服务tab",
				"link": "https://url.to.service",
				"toast": "点击时的提示",
				"emoji": "🗺️"
			}
		]`,
	},
	{
		Key:   "brand",
		Value: "Campux 这个是你的墙的名称",
	},
	{
		Key:   "beianhao",
		Value: "桂ICP备1145141919号-1",
	},
}

type UserGroup string

const (
	USER_GROUP_ANY    UserGroup = "any"
	USER_GROUP_ADMIN  UserGroup = "admin"
	USER_GROUP_MEMBER UserGroup = "member"
	USER_GROUP_USER   UserGroup = "user"
)

type BanInfo struct {
	Uin       int64     `json:"uin" bson:"uin"`                                     // QQ号
	Op        int64     `json:"op" bson:"op"`                                       // 操作者QQ号
	Comment   string    `json:"comment" bson:"comment" gorm:"type:varchar(512)"`    // 备注
	StartTime time.Time `json:"start_time" bson:"start_time" gorm:"autoCreateTime"` // 开始时间
	EndTime   time.Time `json:"end_time" bson:"end_time"`                           // 结束时间
}

type AccountPO struct {
	Uin       int64     `json:"uin" bson:"uin"`                                                               // QQ号
	Pwd       string    `json:"pwd" bson:"pwd" gorm:"type:varchar(256);not null"`                             // 数据库存md5之后的密码
	CreatedAt time.Time `json:"created_at" bson:"created_at" gorm:"autoCreateTime"`                           // CST时间
	UserGroup UserGroup `json:"user_group" bson:"user_group" gorm:"type:varchar(32);not null;default:'user'"` // 用户
}

type AccountExpose struct {
	Uin       int64     `json:"uin" bson:"uin"`               // QQ号
	UserGroup UserGroup `json:"user_group" bson:"user_group"` // 用户组
	CreatedAt time.Time `json:"created_at" bson:"created_at"` // CST时间
	BanRecord []BanInfo `json:"ban_record" gorm:"-"`          // 封禁记录
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
	ID        int           `json:"id" bson:"id" gorm:"primary_key;auto_increment"`                                   // 稿件ID
	UUID      string        `json:"uuid" bson:"uuid" gorm:"type:varchar(256);unique"`                                 // UUID
	Uin       int64         `json:"uin" bson:"uin"`                                                                   // 作者QQ号
	Text      string        `json:"text" bson:"text" gorm:"type:varchar(2048);not null"`                              // 正文
	Images    util.StrArray `json:"images" bson:"images" gorm:"type:text"`                                            // 图片
	Anon      bool          `json:"anon" bson:"anon"`                                                                 // 是否匿名
	Status    PostStatus    `json:"status" bson:"status" gorm:"type:varchar(32);not null;default:'pending_approval'"` // 状态
	CreatedAt time.Time     `json:"created_at" bson:"created_at" gorm:"autoCreateTime"`                               // CST时间
}

type PostLogPO struct {
	PostID    int        `json:"post_id" bson:"post_id"`                             // 稿件ID
	Op        int64      `json:"op" bson:"op"`                                       // 操作者ID -1表示系统
	OldStat   PostStatus `json:"old_stat" bson:"old_stat" gorm:"type:varchar(32)"`   // 旧状态
	NewStat   PostStatus `json:"new_stat" bson:"new_stat" gorm:"type:varchar(32)"`   // 新状态
	Comment   string     `json:"comment" bson:"comment" gorm:"type:varchar(256)"`    // 备注
	CreatedAt time.Time  `json:"created_at" bson:"created_at" gorm:"autoCreateTime"` // CST时间
}

type PostVerbose struct {
	PostID    int          `json:"post_id" bson:"post_id"`                             // 稿件ID
	Key       string       `json:"key" bson:"key" gorm:"type:varchar(256)"`            // 多Bot场景下识别的Key
	Values    util.JSONMap `json:"values" bson:"values" gorm:"type:text"`              // 值
	CreatedAt time.Time    `json:"created_at" bson:"created_at" gorm:"autoCreateTime"` // CST时间
}

type ReviewOption string

const (
	REVIEW_OPTION_APPROVE ReviewOption = "approve"
	REVIEW_OPTION_REJECT  ReviewOption = "reject"
)

type OAuthAppPO struct {
	Name         string    `json:"name" bson:"name" gorm:"type:varchar(256)"`                   // 应用名称
	Emoji        string    `json:"emoji" bson:"emoji" gorm:"type:varchar(16)"`                  // Emoji
	ClientID     string    `json:"client_id" bson:"client_id" gorm:"type:varchar(256)"`         // 客户端ID
	ClientSecret string    `json:"client_secret" bson:"client_secret" gorm:"type:varchar(256)"` // 客户端密钥
	CreatedAt    time.Time `json:"created_at" bson:"created_at" gorm:"autoCreateTime"`          // CST时间
}

type WebhookPO struct {
	ID        int       `json:"id" bson:"id" gorm:"primary_key;auto_increment"`     // Webhook ID
	Name      string    `json:"name" bson:"name" gorm:"type:varchar(256)"`          // Webhook名称
	URL       string    `json:"url" bson:"url" gorm:"type:varchar(512)"`            // Webhook URL
	Enabled   bool      `json:"enabled" bson:"enabled" gorm:"default:true"`         // 是否启用
	CreatedAt time.Time `json:"created_at" bson:"created_at" gorm:"autoCreateTime"` // CST时间
}
