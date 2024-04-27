package routine

import (
	"fmt"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/mq"
	"github.com/RockChinQ/Campux/backend/util"
)

func ConfirmPosted(db database.MongoDBManager, msq mq.RedisStreamMQ) {
	// 取出状态为“队列中”的稿件
	// 检查消息队列中HGETALL publish_post_status:post_id 的所有值是否都是1
	// 如果是, 则更新稿件状态为“已发布”
	inQueuePosts, err := db.GetPosts(-1, database.POST_STATUS_IN_QUEUE, 1, 1, 10)
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
		}
	}

}
