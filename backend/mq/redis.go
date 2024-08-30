package mq

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/spf13/viper"
)

type RedisStreamMQ struct {
	Client            *redis.Client
	PublishPostStream string
	NewPostStream     string
	PostCancelStream  string

	PublishStatusHash string
	Oauth2CodeHash    string
}

func NewRedisStreamMQ() *RedisStreamMQ {
	client := redis.NewClient(&redis.Options{
		Addr:     viper.GetString("mq.redis.addr"),
		Password: viper.GetString("mq.redis.password"),
		DB:       viper.GetInt("mq.redis.db"),
	})

	redis := &RedisStreamMQ{
		Client:            client,
		PublishPostStream: viper.GetString("service.domain") + ".publish_post",
		NewPostStream:     viper.GetString("service.domain") + ".new_post",
		PostCancelStream:  viper.GetString("service.domain") + ".post_cancel",
		PublishStatusHash: viper.GetString("service.domain") + ".post_publish_status",
		Oauth2CodeHash:    viper.GetString("service.domain") + ".oauth2_code",
	}

	// 检查流是否存在
	client.XGroupCreateMkStream(context.Background(), redis.PublishPostStream, "campux", "0")
	client.XGroupCreateMkStream(context.Background(), redis.NewPostStream, "campux", "0")
	client.XGroupCreateMkStream(context.Background(), redis.PostCancelStream, "campux", "0")

	return redis
}

func (r *RedisStreamMQ) PublishPost(postID int) error {
	_, err := r.Client.XAdd(context.Background(), &redis.XAddArgs{
		Stream: r.PublishPostStream,
		Values: map[string]interface{}{
			"post_id": postID,
		},
	}).Result()

	if err != nil {
		return err
	}

	// 创建散列表跟踪发布状态 HSET {{ viper.GetString("mq.redis.hash.post_publish_status") }}post_id campuxbot_1234567 0 campuxbot_1234568 0
	var bots []int64

	err = viper.UnmarshalKey("service.bots", &bots)

	if err != nil {
		return err
	}

	for _, bot := range bots {
		err = r.Client.HSet(context.Background(), r.PublishStatusHash+":"+strconv.Itoa(postID), "campuxbot_"+strconv.FormatInt(bot, 10), 0).Err()

		if err != nil {
			return err
		}
	}

	return nil
}

func (r *RedisStreamMQ) NewPost(postID int) error {
	_, err := r.Client.XAdd(context.Background(), &redis.XAddArgs{
		Stream: r.NewPostStream,
		Values: map[string]interface{}{
			"post_id": postID,
		},
	}).Result()
	return err
}

func (r *RedisStreamMQ) PostCancel(postID int) error {
	_, err := r.Client.XAdd(context.Background(), &redis.XAddArgs{
		Stream: r.PostCancelStream,
		Values: map[string]interface{}{
			"post_id": postID,
		},
	}).Result()
	return err
}

func (r *RedisStreamMQ) CheckPostPublishStatus(postID int) (bool, error) {
	// HGETALL {{ viper.GetString("mq.redis.hash.post_publish_status") }}77
	status, err := r.Client.HGetAll(context.Background(), r.PublishStatusHash+":"+strconv.Itoa(postID)).Result()

	if err != nil {
		return false, err
	}

	for _, v := range status {
		if v != "1" {
			return false, nil
		}
	}

	return true, nil
}

// 删除稿件发布跟踪hash表
func (r *RedisStreamMQ) DeletePostPublishStatus(postID int) error {
	_, err := r.Client.Del(context.Background(), r.PublishStatusHash+":"+strconv.Itoa(postID)).Result()
	return err
}

// 存储oauth2_code和uin对应关系 十分钟过期
func (r *RedisStreamMQ) SetOauth2Code(code string, uin int64) error {
	return r.Client.Set(context.Background(), r.Oauth2CodeHash+code, uin, 60*10*time.Second).Err()
}

// 获取oauth2_code对应的uin
func (r *RedisStreamMQ) GetOauth2Uin(code string) (int64, error) {
	return r.Client.Get(context.Background(), r.Oauth2CodeHash+code).Int64()
}
