<template>

  <BottomNavBar v-model="value" @input="go" />

  <v-tabs v-model="tab" align-tabs="center" color="deep-purple-accent-4" show-arrows>
    <v-tab value="1">你的稿件</v-tab>
    <v-tab value="2">动态</v-tab>
    <v-tab v-if="userGroup === 'admin'" value="3">审核稿件</v-tab>
  </v-tabs>

  <v-window v-model="tab">
    <v-window-item value="1" style="overflow-y: scroll">
      <div style="padding: 16px;">
        <v-select v-model="filter.status" label="按条件筛选" :items="filterStatus" variant="solo"
          @update:model-value="refreshPosts"></v-select>
        <div style="overflow-y: scroll; max-height: 74vh;">
          <PostCard v-for="p in posts" :key="p.id" :post="p" typ="self" style="margin-top: 16px" @recall="recallPost" />
        </div>
      </div>
    </v-window-item>
    <v-window-item value="2">
      <div style="display: flex; justify-content: center; align-items: center;">
        <p style="margin-top: 64px; font-weight: bold">前面的区域，以后再来探索吧</p>
      </div>
    </v-window-item>
    <v-window-item value="3">
      <div style="padding: 16px;">
        <v-select v-model="filterForJudge.status" label="按条件筛选" :items="filterStatus" variant="solo"
          @update:model-value="refreshPosts"></v-select>
        <div style="overflow-y: scroll; max-height: 74vh;">
          <PostCard v-for="p in judgePosts" :key="p.id" :post="p" typ="judge" style="margin-top: 16px" @updateJudgePost="updateJudgePost" />
        </div>
      </div>
    </v-window-item>
  </v-window>

  <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout">
    {{ snackbar.text }}
  </v-snackbar>

  <!-- fix在屏幕右下方 -->
  <div style="position: fixed; right: 32px; bottom: 80px;">
    <v-btn density="default" icon="mdi-refresh" size="large" :loading="pullLoading" color="primary"
      @click="refreshPosts"></v-btn>
  </div>
</template>

<script>
import BottomNavBar from '@/components/BottomNavBar.vue'
import PostCard from '@/components/PostCard.vue'
export default {
  components: {
    BottomNavBar
  },
  data() {
    return {
      snackbar: {
        show: false,
        text: '',
        color: ''
      },
      value: 1,
      filter: {
        "status": "全部", // 状态
        "time_order": 1, // 时间排序
        "page": 1,
        "page_size": 999
      },
      filterForJudge: {
        "uin": -1,
        "status": "待审核", // 状态
        "time_order": 1, // 时间排序
        "page": 1,
        "page_size": 10
      },
      posts: [],
      statusMap: {
        "pending_approval": "待审核",
        "approved": "已通过",
        "rejected": "已拒绝",
        "cancelled": "已取消",
        "in_queue": "队列中",
        "published": "已发布",
        "failed": "失败",
        "any": "全部",
        "pending_recall": "待撤回",
        "recalled": "已撤回"
      },
      filterStatus: ['全部', '待审核', '已通过', '已拒绝', '已取消', '队列中', '已发布', '失败', '待撤回', '已撤回'],
      tab: null,
      uin: "",
      avatarUrl: "",
      userGroup: "user",
      judgePosts: [],
      pullLoading: false
    }
  },

  mounted() {
    this.getPosts()
    this.tokenLogin()
  },

  methods: {
    updateJudgePost(p) {
      if (p.status === "通过") {
        p.status = 'approve'
      } else if (p.status === "拒绝") {
        p.status = 'reject'
        if (p.reason === "") {
          p.reason = "无理由"
        }
      }

      let form = {
        "post_id": p.id,
        "option": p.status,
        "comment": p.reason
      }

      this.$axios.post('/v1/post/review-post', form)
        .then((response) => {
          if (response.data.code === 0) {
            this.toast('已经将该稿件' + p.status, 'success')
            this.refreshPosts()
          } else {
            this.toast('操作失败：' + response.data.msg)
          }
        })
        .catch((error) => {
          this.toast('操作失败：' + error.response.data.msg)
          console.error(error)
        })
    },
    refreshPosts() {
      if (this.tab === '1') {
        this.getPosts()
      } else if (this.tab === '3') {
        this.getJudgePosts()
      }
    },
    getJudgePosts() {
      console.log(this.filterForJudge)
      // 检查status
      let filter = JSON.parse(JSON.stringify(this.filterForJudge))
      for (let key in this.statusMap) {
        if (this.statusMap[key] === this.filterForJudge.status) {
          filter.status = key
          break
        }
      }
      this.pullLoading = true
      this.$axios.post('/v1/post/get-posts', filter)
        .then((response) => {
          if (response.data.code === 0) {
            let p = response.data.data.list
            if (p === null) {
              this.toast('无记录')
              this.judgePosts = []
              this.pullLoading = false
              return
            }
            // reverse
            p.reverse()
            for (let i = 0; i < p.length; i++) {
              // 2024-04-12T08:19:51.096Z 转成日期，再转成字符串
              let date = new Date(p[i].created_at)
              p[i].created_at = date.getUTCFullYear() + "-" + (date.getUTCMonth() + 1) + "-" + date.getUTCDate() + " " + date.getUTCHours() + ":" + date.getUTCMinutes() + ":" + date.getUTCSeconds()
              p[i].status = this.statusMap[p[i].status]
              for (let j = 0; j < p[i].images.length; j++) {
                p[i].images[j] = this.$baseurl.value + p[i].images[j]
              }
            }
            console.log(p)
            this.judgePosts = p
          } else {
            this.toast(response.data.msg)
          }
          this.pullLoading = false
          console.log(response.data)
        })
        .catch((error) => {
          this.pullLoading = false
          if (error.response.data.code === -1) {
            this.$router.push('/auth?hint=请先登录嗷')
            return
          }
          this.toast('获取稿件失败')
          console.log(error)
        })
    },
    tokenLogin() {
      this.$axios.get('/v1/account/token-check')
        .then(res => {
          if (res.data.code === 0) {
            this.uin = res.data.data.uin
            this.avatarUrl = "http://q1.qlogo.cn/g?b=qq&nk=" + res.data.data.uin + "&s=100"
            this.userGroup = res.data.data.user_group
          } else {
            this.toast('登录失败：' + res.data.msg)
          }
        })
        .catch(err => {
          if (err.response.data.code === -1) {
            this.$router.push('/auth?hint=请先登录嗷')
            return
          }
          this.toast('登录失败：' + err.response.data.msg)
          console.error(err)
        })
    },
    getPosts() {
      console.log(this.filter)
      // 检查status
      let filter = JSON.parse(JSON.stringify(this.filter))
      for (let key in this.statusMap) {
        if (this.statusMap[key] === this.filter.status) {
          filter.status = key
          break
        }
      }
      this.pullLoading = true
      this.$axios.post('/v1/post/get-self-posts', filter)
        .then((response) => {
          if (response.data.code === 0) {
            let p = response.data.data.list
            if (p === null) {
              this.toast('无记录')
              this.posts = []
              this.pullLoading = false
              return
            }
            // reverse
            p.reverse()
            for (let i = 0; i < p.length; i++) {
              // 2024-04-12T08:19:51.096Z 转成日期，再转成字符串，转成 YYYY-MM-DD HH:MM:SS UTC+8
              let date = new Date(p[i].created_at)
              p[i].created_at = date.getUTCFullYear() + "-" + (date.getUTCMonth() + 1) + "-" + date.getUTCDate() + " " + date.getUTCHours() + ":" + date.getUTCMinutes() + ":" + date.getUTCSeconds()
              p[i].status = this.statusMap[p[i].status]
              for (let j = 0; j < p[i].images.length; j++) {
                p[i].images[j] = this.$baseurl.value + p[i].images[j]
              }
            }
            console.log(p)
            this.posts = p
          } else {
            this.toast(response.data.msg)
          }
          this.pullLoading = false
          console.log(response.data)
        })
        .catch((error) => {
          this.pullLoading = false
          if (error.response.data.code === -1) {
            this.$router.push('/auth?hint=请先登录嗷')
            return
          }
          this.toast('获取稿件失败')
          console.log(error)
        })
    },
    toast(text, color = 'error') {
      this.snackbar.text = text
      this.snackbar.color = color
    },
    recallPost(post) {
      console.log(post)
      this.$axios.post('/v1/post/cancel', {
        "post_id": post.id
      })
        .then((response) => {
          if (response.data.code === 0) {
            this.toast('撤回成功', 'success')
            this.getPosts()
          } else {
            this.toast('撤回失败：' + response.data.msg)
          }
        })
        .catch((error) => {
          this.toast('撤回失败：' + error.response.data.msg)
          console.error(error)
        })
    },
  }
}
</script>