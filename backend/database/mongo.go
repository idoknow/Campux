package database

import (
	"context"

	"github.com/spf13/viper"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	ACCOUNT_COLLECTION = "account"
	POST_COLLECTION    = "post"
)

type MongoDBManager struct {
	Client *mongo.Client
}

func NewMongoDBManager() *MongoDBManager {
	client, err := mongo.Connect(
		context.TODO(),
		options.Client().ApplyURI(viper.GetString("database.mongo.uri")),
	)
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

	return &MongoDBManager{
		Client: client,
	}
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

func (m *MongoDBManager) UpdatePassword(uin int64, pwd, salt string) error {

	// 更新
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(ACCOUNT_COLLECTION).UpdateOne(
		context.TODO(),
		bson.M{
			"uin": uin,
		},
		bson.M{
			"$set": bson.M{
				"pwd":  pwd,
				"salt": salt,
			},
		},
	)
	return err
}

func (m *MongoDBManager) CountPost() (int, error) {
	count, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).CountDocuments(context.TODO(), bson.M{})
	return int(count), err
}

func (m *MongoDBManager) AddPost(post *PostPO) error {
	_, err := m.Client.Database(viper.GetString("database.mongo.db")).Collection(POST_COLLECTION).InsertOne(context.TODO(), post)
	return err
}
