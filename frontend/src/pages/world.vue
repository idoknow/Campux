<template>

  <BottomNavBar v-model="value" @input="go" />
  
  <v-tabs v-model="tab" align-tabs="center" color="deep-purple-accent-4">
    <v-tab value="1">稿件管理</v-tab>
    <v-tab value="2">动态</v-tab>
  </v-tabs>

  <v-window v-model="tab">
    <v-window-item value="1" style="overflow-y: scroll">
      <div style="padding: 16px;">
        <v-select
          v-model="filter.status"
          label="按条件筛选"
          :items="filterStatus"
          variant="solo"
          @update:model-value="getPosts"
        ></v-select>
        <PostCard v-for="p in posts" :key="p.id" :post="p" style="margin-top: 16px" />
      </div>
    </v-window-item>
    <v-window-item value="2">
      <div style="display: flex; justify-content: center; align-items: center;">
        <p style="margin-top: 64px; font-weight: bold">前面的区域，以后再来探索吧</p>
      </div>
    </v-window-item>
  </v-window>

  <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout">
    {{ snackbar.text }}
  </v-snackbar>
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
    }
  },

  mounted() {
    this.getPosts()
  },

  methods: {
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

      this.$axios.post('/v1/post/get-self-posts', filter)
        .then((response) => {
          if (response.data.code === 0) {
            let p = response.data.data.list
            if (p === null) {
              this.toast('无记录')
              this.posts = []
              return
            }
            // reverse
            p.reverse()
            for (let i = 0; i < p.length; i++) {
              // 2024-04-12T08:19:51.096Z 转成日期，再转成字符串
              p[i].created_at = new Date(p[i].created_at).toLocaleString()
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
          console.log(response.data)
        })
        .catch((error) => {
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
    }
  }
}
</script>