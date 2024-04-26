package routine

import (
	"fmt"

	"github.com/RockChinQ/Campux/backend/database"
	"github.com/RockChinQ/Campux/backend/mq"
	"github.com/RockChinQ/Campux/backend/util"
)

func SchedulePublishing(db database.MongoDBManager, msq mq.RedisStreamMQ) {
	// 从数据库中查询出所有待发布的稿件
	// 遍历稿件, 发布到消息队列
	// 更新稿件状态
	approvedPosts, err := db.GetPosts(-1, database.POST_STATUS_APPROVED, 1, 1, 10)
	if err != nil {
		return
	}

	for _, post := range approvedPosts {
		err = msq.PublishPost(post.ID)
		if err != nil {
			fmt.Println(err)
			continue
		}

		// 加日志
		err = db.AddPostLog(&database.PostLogPO{
			PostID:    post.ID,
			Op:        -1,
			OldStat:   database.POST_STATUS_APPROVED,
			NewStat:   database.POST_STATUS_IN_QUEUE,
			Comment:   "发布到消息队列",
			CreatedAt: util.GetCSTTime(),
		})
		if err != nil {
			fmt.Println(err)
			continue
		}

		err = db.UpdatePostStatus(post.ID, database.POST_STATUS_IN_QUEUE)
		if err != nil {
			fmt.Println(err)
			continue
		}
	}
}
