package mq

import (
	"context"

	"github.com/redis/go-redis/v9"
	"github.com/spf13/viper"
)

type RedisStreamMQ struct {
	Client            *redis.Client
	PublishPostStream string
}

func NewRedisStreamMQ() *RedisStreamMQ {
	client := redis.NewClient(&redis.Options{
		Addr:     viper.GetString("mq.redis.addr"),
		Password: viper.GetString("mq.redis.password"),
		DB:       viper.GetInt("mq.redis.db"),
	})
	return &RedisStreamMQ{
		Client:            client,
		PublishPostStream: viper.GetString("mq.redis.stream.publish_post"),
	}
}

func (r *RedisStreamMQ) PublishPost(postID int) error {
	_, err := r.Client.XAdd(context.Background(), &redis.XAddArgs{
		Stream: r.PublishPostStream,
		Values: map[string]interface{}{
			"post_id": postID,
		},
	}).Result()
	return err
}
