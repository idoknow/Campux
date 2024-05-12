<template>
  <v-card class="mx-auto postcard" :color="backgrouldColor" max-width="400" style="border-radius: 10px; color: #fff">
    <div style="width: 100%; padding: 8px 8px 0px 8px">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center;">
          <v-icon color="white" style="font-size: 25px">mdi-pin</v-icon>
          <h3 style="margin-left: 8px">稿件 #{{ post.id }}</h3>
        </div>
        <!-- 取消投稿 -->
        <v-btn v-if="typ === 'self' && post.status == '待审核'" text="取消" @click="recall" variant="plain"></v-btn>
        <v-btn v-else variant="plain" @click="showLogs">日志</v-btn>
      </div>

    </div>

    <v-card-text class="py-2" style="font-size: 16px; font-weight: bold; line-height: 1.5; word-spacing: 2px">
      {{ post.text }}
    </v-card-text>

    <div
      style="display: flex; margin-left: 16px; margin-right: 16px; margin-top: 8px; overflow-x: auto; white-space: nowrap;">
      <img v-for="img in post.images" :key="img" :src="img"
        style="border-radius: 10px; margin-right: 8px; width: 100px; height: 100px; object-fit: cover" />
    </div>

    <v-card-actions>
      <v-list-item class="w-100">
        <template v-slot:prepend>
          <v-avatar v-if="!post.anon" color="grey-darken-3" :image="avatarBaseUrl + post.uin + '&s=100'"></v-avatar>
          <span v-else style="font-size: 36px; margin-right: 16px">🫥</span>
        </template>

        <v-list-item-title v-if="!post.anon">{{ post.uin }}</v-list-item-title>
        <v-list-item-title v-if="post.anon && typ==='self'">匿名</v-list-item-title>
        <v-list-item-title v-if="post.anon && typ!=='self'">匿名({{ post.uin }})</v-list-item-title>

        <v-list-item-subtitle>{{ post.created_at }}</v-list-item-subtitle>

        <template v-slot:append>
          <div class="justify-self-end">
            <!-- <v-icon class="me-1" icon="mdi-heart"></v-icon>
            <span class="subheading me-2">256</span>
            <span class="me-1">·</span>
            <v-icon class="me-1" icon="mdi-share-variant"></v-icon>
            <span class="subheading">45</span> -->
            <v-menu v-if="typ === 'judge' && post.status === '待审核'">
              <template v-slot:activator="{ props }">
                <v-btn v-bind="props">
                  标记为
                </v-btn>
              </template>
              <v-list @click:select="updateJudgePost">
                <v-list-item v-for="(item, index) in filterStatus" :key="index" :value="index">
                  <v-list-item-title>{{ item }}</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
            <span @click="showLogs" v-else class="subheading" style="font-weight: bold; text-decoration: underline">{{ post.status }}</span>

          </div>
        </template>
      </v-list-item>
    </v-card-actions>
  </v-card>

  <v-dialog v-model="dialog" variant="outlined" persistent>
    <v-card
      title="拒绝原因">
      <v-card-text>
        <v-text-field v-model="reason" label="拒绝原因" outlined></v-text-field>
      </v-card-text>
      <template v-slot:actions>
        <v-btn text="取消" @click="dialog = false"></v-btn>
        <v-btn class="ms-auto" text="OK" @click="dialog = false; emitJudgePost()"></v-btn>
      </template>
    </v-card>
  </v-dialog>

  <v-dialog v-model="logDialog" variant="outlined" persistent>
    <v-card
      title="日志">
      <v-card-text>
        <div class="logCard" v-for="(l,index) in log" :key="index">
          <h3>{{ l.comment }}</h3>
          <p><strong>时间: </strong>{{ l.created_at }}</p>
          <p v-if="l.op !== -1 && typ != 'self'"><strong>操作者: </strong>{{ l.op }}</p>
          <p><strong>状态: </strong> {{ this.$store.state.statusMap[l.new_stat] }}</p>
        </div>
      </v-card-text>
      <template v-slot:actions>
        <v-btn class="ms-auto" text="OK" @click="logDialog = false"></v-btn>
      </template>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: 'PostCard',
  props: ['post', 'typ', 'currentFilterStatus'],
  data() {
    return {
      dialog: false,
      reason: "",

      filterStatus: ['通过', '拒绝', '无理由拒绝'],
      backgrouldColor: "",
      avatarBaseUrl: "http://q1.qlogo.cn/g?b=qq&nk=",
      logDialog: false,
      log: []
    }
  },
  mounted() {
    this.backgrouldColor = this.randomColor()
  },
  methods: {
    randomColor() {
      let colors = ["#FFC107", "#42A5F5", "#9CCC65", "#F06292", "#9E9E9E", "#8D6E63"]
      switch (this.post.status) {
        case '待审核':
          return colors[5]
        case '已通过':
          return colors[2]
        case '已拒绝':
          return colors[3]
        case '已取消':
          return colors[0]
        case '已发布':
          return colors[1]
        default:
          return colors[4]
      }
      // return colors[Math.floor(Math.random() * 100) % colors.length]
    },
    recall() {
      this.$emit('recall', this.post.id)
    },
    updateJudgePost(e) {
      // console.log(e)
      let status = this.filterStatus[e.id]
      this.post.status = status
      if (status === '拒绝') {
        this.dialog = true
      } else {
        this.emitJudgePost()
      }
    },
    emitJudgePost() {
      this.post.reason = this.reason
      this.$emit('updateJudgePost', this.post)
    },
    showLogs() {
      this.$axios.get('/v1/post/post-log/' + this.post.id)
        .then(res => {
          if (res.data.code === 0) {
            let logs = res.data.data.list.reverse()
            for (let i = 0; i < logs.length; i++) {
              logs[i].created_at = new Date(logs[i].created_at).toLocaleString()
              if (logs[i].comment === '') {
                if (logs[i].new_stat === 'approved') {
                  logs[i].comment = '通过'
                } else if (logs[i].new_stat === 'rejected') {
                  logs[i].comment = '拒绝（无理由）'
                }
              }
            }
            this.log = logs
            this.logDialog = true

          } else {
            this.$toast('获取日志失败：' + res.data.msg)
          }
        })
        .catch(err => {
          this.$toast('获取日志失败：' + err.response.data.msg)
          console.error(err)
        })
    }
  }
}
</script>

<style>
.postcard {
  margin-bottom: 16px;
  box-shadow: 0px 10px 15px -3px rgba(0, 0, 0, 0.1);
}

.logCard {
  margin-bottom: 16px;
  padding: 8px;
  border-radius: 10px;
  background-color: #f5f5f5;
}
</style>