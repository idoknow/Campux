package mq

import (
	"context"
	"strconv"

	"github.com/redis/go-redis/v9"
	"github.com/spf13/viper"
)

type RedisStreamMQ struct {
	Client            *redis.Client
	PublishPostStream string
	NewPostStream     string
}

func NewRedisStreamMQ() *RedisStreamMQ {
	client := redis.NewClient(&redis.Options{
		Addr:     viper.GetString("mq.redis.addr"),
		Password: viper.GetString("mq.redis.password"),
		DB:       viper.GetInt("mq.redis.db"),
	})

	// 检查流是否存在
	client.XGroupCreateMkStream(context.Background(), viper.GetString("mq.redis.stream.publish_post"), "campux", "0")
	client.XGroupCreateMkStream(context.Background(), viper.GetString("mq.redis.stream.new_post"), "campux", "0")

	return &RedisStreamMQ{
		Client:            client,
		PublishPostStream: viper.GetString("mq.redis.stream.publish_post"),
		NewPostStream:     viper.GetString("mq.redis.stream.new_post"),
	}
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

	// 创建散列表跟踪发布状态 HSET publish_post_status:post_id campuxbot_1234567 0 campuxbot_1234568 0
	var bots []int64

	err = viper.UnmarshalKey("service.bots", &bots)

	if err != nil {
		return err
	}

	for _, bot := range bots {
		err = r.Client.HSet(context.Background(), "publish_post_status:"+strconv.Itoa(postID), "campuxbot_"+strconv.FormatInt(bot, 10), 0).Err()

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
