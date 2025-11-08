package database

import (
	"sync"

	"github.com/RockChinQ/Campux/backend/util"
	"github.com/spf13/viper"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type SQLiteDBManager struct {
	Client *gorm.DB

	PostLock *sync.Mutex
}

func NewSQLiteDBManager() *SQLiteDBManager {
	db, err := gorm.Open(sqlite.Open(viper.GetString("database.sqlite.path")), &gorm.Config{})

	if err != nil {
		panic(err)
	}

	db.AutoMigrate(&AccountPO{})
	db.AutoMigrate(&PostPO{})
	db.AutoMigrate(&PostLogPO{})
	db.AutoMigrate(&PostVerbose{})
	db.AutoMigrate(&Metadata{})
	db.AutoMigrate(&BanInfo{})
	db.AutoMigrate(&OAuthAppPO{})
	db.AutoMigrate(&WebhookPO{})

	m := &SQLiteDBManager{
		Client:   db,
		PostLock: &sync.Mutex{},
	}

	err = m.CheckMetadata()

	if err != nil {
		panic(err)
	}

	return m
}

// 检查所有元数据的key是否存在，不存在则插入预设的
func (m *SQLiteDBManager) CheckMetadata() error {
	// 关闭autoCommit
	tx := m.Client.Begin()

	for _, metadata := range PresetMetadata {
		var count int64
		tx.Model(&Metadata{}).Where("key = ?", metadata.Key).Count(&count)

		if count == 0 {
			err := tx.Create(&metadata).Error

			if err != nil {
				tx.Rollback()
				return err
			}
		}
	}

	tx.Commit()

	return nil
}

func (m *SQLiteDBManager) AddAccount(acc *AccountPO) error {
	return m.Client.Create(acc).Error
}

func (m *SQLiteDBManager) GetAccountByUIN(uin int64) (*AccountPO, error) {
	// 检查是否存在
	// 获取

	var acc AccountPO
	err := m.Client.Where("uin = ?", uin).First(&acc).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &acc, nil
}

func (m *SQLiteDBManager) UpdatePassword(uin int64, pwd string) error {

	// 更新
	return m.Client.Model(&AccountPO{}).Where("uin = ?", uin).Update("pwd", pwd).Error
}

func (m *SQLiteDBManager) GetAccounts(
	uin int64,
	userGroup UserGroup,
	timeOrder int,
	page, pageSize int,
) ([]AccountExpose, int, error) {
	var accounts []AccountExpose

	db := m.Client.Model(&AccountPO{})
	if uin != -1 {
		db = db.Where("uin = ?", uin)
	}

	if userGroup != USER_GROUP_ANY {
		db = db.Where("user_group = ?", userGroup)
	}

	var total int64

	err := db.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = db.Offset((page - 1) * pageSize).Limit(pageSize).Find(&accounts).Error
	if err != nil {
		return nil, 0, err
	}

	// 获取ban_list中与账号uin相同的记录
	for i := range accounts {
		var banList []BanInfo
		err = m.Client.Where("uin = ?", accounts[i].Uin).Find(&banList).Error
		if err != nil {
			return nil, 0, err
		}
		accounts[i].BanRecord = banList
	}

	return accounts, int(total), nil
}

func (m *SQLiteDBManager) BanAccount(banInfo BanInfo) error {
	return m.Client.Create(&banInfo).Error
}

func (m *SQLiteDBManager) UnbanAccount(uin int64) error {
	// 把最后一个此账号的封禁记录的结束时间设置为当前
	crtTime := util.GetCSTTime()

	var banInfo BanInfo

	err := m.Client.Where("uin = ? AND end_time > ?", uin, crtTime).Last(&banInfo).Error

	if err != nil {
		return err
	}

	banInfo.EndTime = crtTime

	return m.Client.Save(&banInfo).Error
}

// 获取封禁记录
func (m *SQLiteDBManager) GetBanList(
	uin int64,
	onlyValid bool,
	timeOrder int,
	page, pageSize int,
) ([]BanInfo, int, error) {
	// 改成gorm
	var banList []BanInfo

	db := m.Client.Model(&BanInfo{})
	if uin != -1 {
		db = db.Where("uin = ?", uin)
	}

	if onlyValid {
		db = db.Where("end_time > ?", util.GetCSTTime())
	}

	var total int64

	err := db.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = db.Offset((page - 1) * pageSize).Limit(pageSize).Find(&banList).Error
	if err != nil {
		return nil, 0, err
	}

	return banList, int(total), nil
}

// 更改账户的用户组
func (m *SQLiteDBManager) UpdateUserGroup(uin int64, userGroup UserGroup) error {
	return m.Client.Model(&AccountPO{}).Where("uin = ?", uin).Update("user_group", userGroup).Error
}

func (m *SQLiteDBManager) GetCurrentBanInfo(uin int64) (*BanInfo, error) {
	// 改成gorm
	var banInfo BanInfo

	err := m.Client.Where("uin = ? AND end_time > ?", uin, util.GetCSTTime()).Last(&banInfo).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}

	return &banInfo, nil
}

func (m *SQLiteDBManager) CountPost() (int, error) {
	// 改成gorm
	var count int64
	err := m.Client.Model(&PostPO{}).Count(&count).Error
	return int(count), err
}

// 获取当前最大的post id
func (m *SQLiteDBManager) GetMaxPostID() (int, error) {
	// 改成gorm
	var post PostPO
	err := m.Client.Model(&PostPO{}).Order("id desc").First(&post).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return 0, nil
		}
		return 0, err
	}

	return post.ID, nil
}

func (m *SQLiteDBManager) AddPost(post *PostPO) (int, error) {
	// 改成gorm
	// 加锁
	m.PostLock.Lock()

	err := m.Client.Create(post).Error
	if err != nil {
		m.PostLock.Unlock()
		return -1, err
	}

	// 添加日志
	err = m.AddPostLog(&PostLogPO{
		PostID:    post.ID,
		Op:        post.Uin,
		OldStat:   POST_STATUS_ANY,
		NewStat:   POST_STATUS_PENDING_APPROVAL,
		Comment:   "新稿件",
		CreatedAt: util.GetCSTTime(),
	})

	if err != nil {
		m.PostLock.Unlock()
		return -1, err
	}

	m.PostLock.Unlock()

	return post.ID, nil
}

func (m *SQLiteDBManager) AddPostLog(log *PostLogPO) error {
	return m.Client.Create(log).Error
}

func (m *SQLiteDBManager) GetPostLogs(postID int) ([]PostLogPO, error) {
	// 改成gorm
	var logs []PostLogPO
	err := m.Client.Where("post_id = ?", postID).Find(&logs).Error
	if err != nil {
		return nil, err
	}

	return logs, nil
}

func (m *SQLiteDBManager) GetPosts(
	uin int64,
	status PostStatus,
	timeOrder int,
	page, pageSize int,
) ([]PostPO, int, error) {
	// 改成gorm
	var posts []PostPO

	db := m.Client.Model(&PostPO{})
	if uin != -1 {
		db = db.Where("uin = ?", uin)
	}

	if status != POST_STATUS_ANY {
		db = db.Where("status = ?", status)
	}

	var total int64

	err := db.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	err = db.Offset((page - 1) * pageSize).Limit(pageSize).Find(&posts).Error
	if err != nil {
		return nil, 0, err
	}

	return posts, int(total), nil
}

func (m *SQLiteDBManager) GetPost(id int) (*PostPO, error) {
	// 改成gorm
	var post PostPO
	err := m.Client.Where("id = ?", id).First(&post).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}

	return &post, nil
}

func (m *SQLiteDBManager) UpdatePostStatus(id int, status PostStatus) error {
	return m.Client.Model(&PostPO{}).Where("id = ?", id).Update("status", status).Error
}

func (m *SQLiteDBManager) SavePostVerbose(pv *PostVerbose) error {
	return m.Client.Create(pv).Error
}

func (m *SQLiteDBManager) GetMetadata(key string) (string, error) {
	var meta Metadata
	err := m.Client.Where("key = ?", key).First(&meta).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", nil
		}
		return "", err
	}
	return meta.Value, nil
}

func (m *SQLiteDBManager) SetMetadata(key, value string) error {
	return m.Client.Model(&Metadata{}).Where("key = ?", key).Update("value", value).Error
}

func (m *SQLiteDBManager) GetMetadataList() ([]Metadata, error) {
	var list []Metadata
	err := m.Client.Find(&list).Error
	if err != nil {
		return nil, err
	}
	return list, nil
}

func (m *SQLiteDBManager) AddOAuth2App(app *OAuthAppPO) error {
	return m.Client.Create(app).Error
}

func (m *SQLiteDBManager) GetOAuth2App(clientID string) (*OAuthAppPO, error) {
	var app OAuthAppPO
	err := m.Client.Where("client_id = ?", clientID).First(&app).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &app, nil
}

func (m *SQLiteDBManager) GetOAuth2AppByName(name string) (*OAuthAppPO, error) {
	// 改成gorm
	var app OAuthAppPO
	err := m.Client.Where("name = ?", name).First(&app).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &app, nil
}

// list
func (m *SQLiteDBManager) GetOAuth2Apps() ([]OAuthAppPO, error) {
	// 改成gorm
	var apps []OAuthAppPO
	err := m.Client.Find(&apps).Error
	if err != nil {
		return nil, err
	}

	return apps, nil
}

func (m *SQLiteDBManager) DeleteOAuth2App(clientID string) error {
	return m.Client.Where("client_id = ?", clientID).Delete(&OAuthAppPO{}).Error
}

func (m *SQLiteDBManager) AddWebhook(webhook *WebhookPO) error {
	return m.Client.Create(webhook).Error
}

func (m *SQLiteDBManager) GetWebhooks() ([]WebhookPO, error) {
	var webhooks []WebhookPO
	err := m.Client.Find(&webhooks).Error
	if err != nil {
		return nil, err
	}
	return webhooks, nil
}

func (m *SQLiteDBManager) DeleteWebhook(id int) error {
	return m.Client.Where("id = ?", id).Delete(&WebhookPO{}).Error
}
