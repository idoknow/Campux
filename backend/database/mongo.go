package database

import (
	"context"
	"sync"

	"github.com/RockChinQ/Campux/backend/util"
	"github.com/spf13/viper"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	ACCOUNT_COLLECTION      = "account"
	POST_COLLECTION         = "post"
	POST_LOG_COLLECTION     = "post_log"
	POST_VERBOSE_COLLECTION = "post_verbose"
	METADATA_COLLECTION     = "metadata"
	BAN_LIST_COLLECTION     = "ban_list"
	OAUTH_APP_COLLECTION    = "oauth_app"
	WEBHOOK_COLLECTION      = "webhook"
)

type MongoDBManager struct {
	Client *mongo.Client

	PostLock *sync.Mutex
}

func NewMongoDBManager() *MongoDBManager {
	client, err := mongo.Connect(
		context.TODO(),
		options.Client().ApplyURI(viper.GetString("database.mongo.uri")),
	)
	if err != nil {
		panic(err)
	}

	m := &MongoDBManager{
		Client:   client,
		PostLock: &sync.Mutex{},
	}

	// 检查连接
	err = client.Ping(context.TODO(), nil)
	if err != nil {
		panic(err)
	}

	// 元数据

	err = m.CheckMetadata()

	if err != nil {
		panic(err)
	}

	// 创建索引
	// post的uuid
	_, err = client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).Indexes().CreateOne(
		context.TODO(),
		mongo.IndexModel{
			Keys: bson.M{
				"uuid": 1,
			},
			Options: options.Index().SetUnique(true),
		},
	)
	if err != nil {
		panic(err)
	}

	return m
}

// 检查所有元数据的key是否存在，不存在则插入预设的
func (m *MongoDBManager) CheckMetadata() error {
	// 创建collection
	err := m.Client.Database(viper.GetString("database.mongo.db")).CreateCollection(context.TODO(), METADATA_COLLECTION)
	if err != nil {
		return err
	}
	for _, meta := range PresetMetadata {
		exist, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(METADATA_COLLECTION).CountDocuments(
			context.TODO(),
			bson.M{"key": meta.Key},
		)
		if err != nil {
			return err
		}
		if exist == 0 {
			_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(METADATA_COLLECTION).InsertOne(context.TODO(), meta)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *MongoDBManager) AddAccount(acc *AccountPO) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).InsertOne(context.TODO(), acc)
	return err
}

func (m *MongoDBManager) GetAccountByUIN(uin int64) (*AccountPO, error) {

	// 检查是否存在
	exist, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).CountDocuments(context.TODO(), map[string]int64{"uin": uin})
	if err != nil {
		return nil, err
	}
	if exist == 0 {
		return nil, nil
	}

	// 获取
	var acc AccountPO
	err = m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).FindOne(context.TODO(), map[string]int64{"uin": uin}).Decode(&acc)
	if err != nil {
		return nil, err
	}

	return &acc, nil
}

func (m *MongoDBManager) UpdatePassword(uin int64, pwd string) error {

	// 更新
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).UpdateOne(
		context.TODO(),
		bson.M{
			"uin": uin,
		},
		bson.M{
			"$set": bson.M{
				"pwd": pwd,
			},
		},
	)
	return err
}

func (m *MongoDBManager) GetAccounts(
	uin int64,
	userGroup UserGroup,
	timeOrder int,
	page, pageSize int,
) ([]AccountExpose, int, error) {
	var accounts []AccountExpose

	condition := bson.M{}

	if uin != -1 {
		condition["uin"] = uin
	}

	if userGroup != USER_GROUP_ANY {
		condition["user_group"] = userGroup
	}

	findOptions := options.Find()

	findOptions.SetSort(bson.M{"created_at": timeOrder})

	// 获取符合条件的总数
	totalResult, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).CountDocuments(context.TODO(), condition)

	if err != nil {
		return nil, 0, err
	}

	total := int(totalResult)

	findOptions.SetSkip(int64((page - 1) * pageSize))
	findOptions.SetLimit(int64(pageSize))
	cursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).Find(
		context.TODO(),
		condition,
		findOptions,
	)

	if err != nil {
		return nil, 0, err
	}

	defer cursor.Close(context.Background())

	err = cursor.All(context.Background(), &accounts)
	if err != nil {
		return nil, 0, err
	}

	// 获取ban_list中与账号uin相同的记录
	for i := range accounts {
		banCursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(BAN_LIST_COLLECTION).Find(
			context.TODO(),
			bson.M{"uin": accounts[i].Uin},
		)
		if err != nil {
			return nil, 0, err
		}
		var banList []BanInfo
		err = banCursor.All(context.Background(), &banList)
		if err != nil {
			return nil, 0, err
		}
		accounts[i].BanRecord = banList
	}

	return accounts, total, nil
}

func (m *MongoDBManager) BanAccount(banInfo BanInfo) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(BAN_LIST_COLLECTION).InsertOne(context.TODO(), banInfo)
	return err
}

func (m *MongoDBManager) UnbanAccount(uin int64) error {
	// 把最后一个此账号的封禁记录的结束时间设置为当前
	crtTime := util.GetCSTTime()

	filter := bson.M{
		"uin": uin,
		"end_time": bson.M{
			"$gt": crtTime,
		},
	}
	update := bson.M{
		"$set": bson.M{
			"end_time": crtTime,
		},
	}
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(BAN_LIST_COLLECTION).UpdateMany(
		context.TODO(),
		filter,
		update,
	)
	return err
}

// 获取封禁记录
func (m *MongoDBManager) GetBanList(
	uin int64,
	onlyValid bool,
	timeOrder int,
	page, pageSize int,
) ([]BanInfo, int, error) {
	var banList []BanInfo

	condition := bson.M{}

	if uin != -1 {
		condition["uin"] = uin
	}

	if onlyValid {
		condition["end_time"] = bson.M{
			"$gt": util.GetCSTTime(),
		}
	}

	findOptions := options.Find()
	findOptions.SetSort(bson.M{"start_time": timeOrder})

	// 获取符合条件的总数
	totalResult, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(BAN_LIST_COLLECTION).CountDocuments(context.TODO(), condition)

	if err != nil {
		return nil, 0, err
	}

	total := int(totalResult)

	findOptions.SetSkip(int64((page - 1) * pageSize))

	findOptions.SetLimit(int64(pageSize))

	cursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(BAN_LIST_COLLECTION).Find(
		context.TODO(),
		condition,
		findOptions,
	)
	if err != nil {
		return nil, 0, err
	}

	defer cursor.Close(context.Background())

	err = cursor.All(context.Background(), &banList)
	if err != nil {
		return nil, 0, err
	}

	return banList, total, nil
}

// 更改账户的用户组
func (m *MongoDBManager) UpdateUserGroup(uin int64, userGroup UserGroup) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).UpdateOne(
		context.TODO(),
		bson.M{"uin": uin},
		bson.M{"$set": bson.M{"user_group": userGroup}},
	)
	return err
}

func (m *MongoDBManager) GetCurrentBanInfo(uin int64) (*BanInfo, error) {
	var banInfo BanInfo

	// 获取此账号所有的结束时间大于当前时间的封禁记录
	crtTime := util.GetCSTTime()

	err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(BAN_LIST_COLLECTION).FindOne(
		context.TODO(),
		bson.M{
			"uin": uin,
			"end_time": bson.M{
				"$gt": crtTime,
			},
		},
	).Decode(&banInfo)

	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, err
	}

	return &banInfo, nil
}

func (m *MongoDBManager) CountPost() (int, error) {
	count, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).CountDocuments(context.TODO(), bson.M{})
	return int(count), err
}

// 获取当前最大的post id
func (m *MongoDBManager) GetMaxPostID() (int, error) {
	var post struct {
		ID int `bson:"id"`
	}

	err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).FindOne(
		context.TODO(),
		bson.M{},
		options.FindOne().SetSort(bson.M{"id": -1}),
	).Decode(&post)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return 0, nil
		}
		return 0, err
	}

	return post.ID, nil
}

func (m *MongoDBManager) AddPost(post *PostPO) (int, error) {
	// 加锁
	m.PostLock.Lock()

	// 取 id
	id, err := m.GetMaxPostID()

	if err != nil {
		m.PostLock.Unlock()
		return -1, err
	}

	id += 1

	post.ID = id

	_, err = m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).InsertOne(context.TODO(), post)

	if err != nil {
		m.PostLock.Unlock()
		return -1, err
	}

	err = m.AddPostLog(
		&PostLogPO{
			PostID:    id,
			Op:        post.Uin,
			OldStat:   POST_STATUS_ANY,
			NewStat:   POST_STATUS_PENDING_APPROVAL,
			Comment:   "新稿件",
			CreatedAt: util.GetCSTTime(),
		},
	)

	if err != nil {
		m.PostLock.Unlock()
		return -1, err
	}

	m.PostLock.Unlock()
	return id, nil
}

func (m *MongoDBManager) AddPostLog(log *PostLogPO) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_LOG_COLLECTION).InsertOne(context.TODO(), log)
	return err
}

func (m *MongoDBManager) GetPostLogs(postID int) ([]PostLogPO, error) {
	var logs []PostLogPO
	cursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_LOG_COLLECTION).Find(
		context.TODO(),
		bson.M{"post_id": postID},
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	err = cursor.All(context.Background(), &logs)
	if err != nil {
		return nil, err
	}

	return logs, nil
}

func (m *MongoDBManager) GetPosts(
	uin int64,
	status PostStatus,
	timeOrder int,
	page, pageSize int,
) ([]PostPO, int, error) {
	var posts []PostPO

	condition := bson.M{}

	if uin != -1 {
		condition["uin"] = uin
	}

	if status != POST_STATUS_ANY {
		condition["status"] = status
	}

	findOptions := options.Find()
	findOptions.SetSort(bson.M{"created_at": timeOrder})

	// 获取符合条件的总数
	totalResult, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).CountDocuments(context.TODO(), condition)

	if err != nil {
		return nil, 0, err
	}

	total := int(totalResult)

	findOptions.SetSkip(int64((page - 1) * pageSize))
	findOptions.SetLimit(int64(pageSize))

	cursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).Find(
		context.TODO(),
		condition,
		findOptions,
	)
	if err != nil {
		return nil, 0, err
	}
	defer cursor.Close(context.Background())

	err = cursor.All(context.Background(), &posts)
	if err != nil {
		return nil, 0, err
	}

	return posts, total, nil
}

func (m *MongoDBManager) GetPost(id int) (*PostPO, error) {
	var post PostPO
	err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).FindOne(
		context.TODO(),
		bson.M{"id": id},
	).Decode(&post)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		} else {
			return nil, err
		}
	}
	return &post, nil
}

func (m *MongoDBManager) UpdatePostStatus(id int, status PostStatus) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).UpdateOne(
		context.TODO(),
		bson.M{"id": id},
		bson.M{"$set": bson.M{"status": status}},
	)
	return err
}

func (m *MongoDBManager) SavePostVerbose(pv *PostVerbose) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_VERBOSE_COLLECTION).InsertOne(context.TODO(), pv)

	return err
}

func (m *MongoDBManager) GetMetadata(key string) (string, error) {
	var meta struct {
		Value string `bson:"value"`
	}
	err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(METADATA_COLLECTION).FindOne(
		context.TODO(),
		bson.M{"key": key},
	).Decode(&meta)
	if err != nil {
		return "", err
	}
	return meta.Value, nil
}

func (m *MongoDBManager) SetMetadata(key, value string) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(METADATA_COLLECTION).UpdateOne(
		context.TODO(),
		bson.M{"key": key},
		bson.M{"$set": bson.M{"value": value}},
	)
	return err
}

func (m *MongoDBManager) GetMetadataList() ([]Metadata, error) {
	var list []Metadata
	cursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(METADATA_COLLECTION).Find(context.TODO(), bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	err = cursor.All(context.Background(), &list)
	if err != nil {
		return nil, err
	}

	return list, nil
}

func (m *MongoDBManager) AddOAuth2App(app *OAuthAppPO) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(OAUTH_APP_COLLECTION).InsertOne(context.TODO(), app)
	return err
}

func (m *MongoDBManager) GetOAuth2App(clientID string) (*OAuthAppPO, error) {
	var app OAuthAppPO
	err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(OAUTH_APP_COLLECTION).FindOne(
		context.TODO(),
		bson.M{"client_id": clientID},
	).Decode(&app)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, err
	}
	return &app, nil
}

func (m *MongoDBManager) GetOAuth2AppByName(name string) (*OAuthAppPO, error) {
	// 若不存在，返回 nil, nil
	var app OAuthAppPO

	err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(OAUTH_APP_COLLECTION).FindOne(
		context.TODO(),
		bson.M{"name": name},
	).Decode(&app)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, err
	}
	return &app, nil
}

// list
func (m *MongoDBManager) GetOAuth2Apps() ([]OAuthAppPO, error) {
	var apps []OAuthAppPO
	cursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(OAUTH_APP_COLLECTION).Find(context.TODO(), bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	err = cursor.All(context.Background(), &apps)
	if err != nil {
		return nil, err
	}

	return apps, nil
}

func (m *MongoDBManager) DeleteOAuth2App(clientID string) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(OAUTH_APP_COLLECTION).DeleteOne(context.TODO(), bson.M{"client_id": clientID})
	return err
}

func (m *MongoDBManager) AddWebhook(webhook *WebhookPO) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(WEBHOOK_COLLECTION).InsertOne(context.TODO(), webhook)
	return err
}

func (m *MongoDBManager) GetWebhook(id int) (*WebhookPO, error) {
	var webhook WebhookPO
	err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(WEBHOOK_COLLECTION).FindOne(
		context.TODO(),
		bson.M{"id": id},
	).Decode(&webhook)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, nil
		}
		return nil, err
	}
	return &webhook, nil
}

func (m *MongoDBManager) GetWebhooks() ([]WebhookPO, error) {
	var webhooks []WebhookPO
	cursor, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(WEBHOOK_COLLECTION).Find(context.TODO(), bson.M{})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	err = cursor.All(context.Background(), &webhooks)
	if err != nil {
		return nil, err
	}

	return webhooks, nil
}

func (m *MongoDBManager) UpdateWebhook(webhook *WebhookPO) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(WEBHOOK_COLLECTION).UpdateOne(
		context.TODO(),
		bson.M{"id": webhook.ID},
		bson.M{"$set": webhook},
	)
	return err
}

func (m *MongoDBManager) DeleteWebhook(id int) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(WEBHOOK_COLLECTION).DeleteOne(context.TODO(), bson.M{"id": id})
	return err
}
