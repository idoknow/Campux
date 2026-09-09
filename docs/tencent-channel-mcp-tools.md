# 腾讯频道 MCP 官方 Tools 列表 (来源: connect.qq.com 后台 Tools 列表, 用户提供)

## 成员管理
- change_role_member 变更频道身份组的成员
- get_guild_member_list 获取频道成员列表，支持按角色筛选
- modify_guild_role_group 修改频道身份组的名称等资料
- modify_member_shut_up 对指定用户禁言
- kick_guild_member 将指定用户踢出频道
- create_guild_role_group 创建频道身份组
- get_user_info 获取频道内指定用户的个人信息

## 用户操作
- leave_guild 退出指定频道
- join_guild 加入指定频道
- get_my_join_guild_info 获取我已加入的频道列表

## 频道管理
- get_share_info 解析频道分享链接（长链或短链），返回频道、子频道及帖子参数
- create_guild 创建新频道
- get_guild_channel_list 获取频道下的子频道（板块）列表
- update_guild_info 更新频道资料
- upload_guild_avatar_pre 创建频道前预上传头像
- modify_channel 修改频道下指定板块的名称
- update_join_guild_setting 修改频道的加入设置
- create_channel 创建频道下的新板块（子频道）
- upload_guild_avatar 上传或更换频道头像
- get_join_guild_setting 获取频道的加入设置
- delete_channel 删除频道下的指定板块，支持批量删除
- get_guild_info 获取频道基本资料

## 帖子
- get_guild_feeds 获取帖子广场列表，支持多种排序
- top_feed_action 置顶或取消置顶指定帖子，支持全局置顶和板块置顶
- batch_essence 批量设置或取消帖子的精华标记
- get_feed_detail 获取帖子的完整详情
- publish_feed 在指定频道板块发表新帖子
- del_feed 删除指定帖子
- get_channel_timeline_feeds 获取指定板块的帖子列表
- alter_feed 修改已有帖子的标题或正文

## 评论与回复
- do_reply 发表或删除评论下的回复
- get_feed_comments 获取帖子的评论列表，支持翻页
- get_next_page_replies 获取指定评论下的回复列表，支持翻页
- do_comment 发表或删除帖子评论

## 消息通知
- push_group_normal_dm_msg 向指定用户推送频道普通私信消息
- push_essence_feed 向频道全体成员推送精华帖通知，每天最多3次
- push_qq_msg 任务完成后向用户推送一条QQ消息通知

## 互动
- do_like 对评论回复点赞/取消点赞
- do_feed_prefer 对帖子点赞/取消点赞

## 搜索
- get_search_guild_feed 按关键词搜索频道内帖子
- search_guild_content 按关键词搜索频道、帖子或作者

---
注意: 官方列表中**没有** apply_media_upload / upload_feed_image 等"发帖图片上传"工具。
publish_feed 是唯一发帖入口, 带图能力可能在 publish_feed 参数内或经隐藏上传步骤。
upload_guild_avatar 仅用于频道头像, 与发帖渲染图无关。