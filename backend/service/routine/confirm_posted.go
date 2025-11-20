package routine

import (
	"fmt"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/mq"
	"github.com/RockChinQ/Campux/backend/service"
	"github.com/RockChinQ/Campux/backend/util"
)

func ConfirmPosted(db database.BaseDBManager, msq mq.RedisStreamMQ, ws *service.WebhookService) {
	// 取出状态为“队列中”的稿件
	// 检查消息队列中HGETALL {{ viper.GetString("mq.redis.hash.post_publish_status") }}post_id 的所有值是否都是1
	// 如果是, 则更新稿件状态为“已发布”
	inQueuePosts, _, err := db.GetPosts(-1, database.POST_STATUS_IN_QUEUE, 1, 1, 100)
	if err != nil {
		return
	}

	for _, post := range inQueuePosts {
		published, err := msq.CheckPostPublishStatus(post.ID)

		if err != nil {
			fmt.Println(err)
			continue
		}

		if published {
			err = db.UpdatePostStatus(post.ID, database.POST_STATUS_PUBLISHED)
			if err != nil {
				fmt.Println(err)
				continue
			}

			// 删除hash表
			err = msq.DeletePostPublishStatus(post.ID)
			if err != nil {
				fmt.Println(err)
				continue
			}

			// 加日志
			err = db.AddPostLog(&database.PostLogPO{
				PostID:    post.ID,
				Op:        -1,
				OldStat:   database.POST_STATUS_IN_QUEUE,
				NewStat:   database.POST_STATUS_PUBLISHED,
				Comment:   "确认已发布",
				CreatedAt: util.GetCSTTime(),
			})
			if err != nil {
				fmt.Println(err)
				continue
			}

			// Notify webhooks
			if ws != nil {
				go ws.NotifyWebhooks("post_published", &post)
			}
		}
	}

}
