<template>

  <v-banner style="background: #f8b94c; color: #fff; font-size: 14px; text-align: center;" color="warning" lines="one"
    text="📢 投稿前请阅读投稿规则" :stacked="false">
  </v-banner>

  <!-- input area -->
  <textarea style="" name="textarea" v-model="post.text" placeholder="有什么新鲜事？！" class="post"></textarea>
  <div style="margin-left: 16px">
    <!-- 图片上传 -->
    <svg t="1712897639010" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
      p-id="1448" width="70" height="70">
      <path
        d="M85.312 85.312v853.376h853.376V85.312H85.312zM0 0h1024v1024H0V0z m554.624 213.312v256h256v85.376h-256v256H469.312v-256h-256V469.376h256v-256h85.312z"
        fill="#262626" p-id="1449"></path>
    </svg>
  </div>

  <div style="margin-left: 8px;">
    <!-- 标签 -->
    <div style="display: flex; align-items: center">
      <v-chip class="ma-2" color="pink" size="small" label>
        <v-icon icon="mdi-label" start></v-icon>
        标签
      </v-chip>
      <v-chip @click="selectTag(index)" :ripple="true" style="margin-right: 4px;" v-for="(tag, index) in tags" :key="index" size="x-small" :variant="tag.selected ? 'primary' : 'outlined'" :color="tag.selected ? 'primary' : 'pink'" label>
        {{ tag.name }}
      </v-chip>
    </div>
    <small class="taghint">🤔 添加标签可更快过审，不要选择不完全符合内容的标签。</small>

  </div>

  <BottomNavBar v-model="value" @input="go" />

  <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout">
    {{ snackbar.text }}
  </v-snackbar>
</template>

<script>
import BottomNavBar from '@/components/BottomNavBar.vue'
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
      value: 0,
      post: {
        text: '',
        images: [],
      },
      tags: [
        {
          name: '寻物/招领',
          selected: false
        },
        {
          name: '教学升学内容相关问答',
          selected: false
        },
        {
          name: '食堂品质',
          selected: false
        }
      ]
    }
  },

  mounted() {
  },

  methods: {
    selectTag(index) {
      this.tags[index].selected = !this.tags[index].selected
    },
    tokenLogin() {
      this.$axios.post('/v1/account/tokenlogin', { token: this.$route.query.token })
        .then(res => {
          if (res.data.code === 1) {
            this.$router.push('/auth')
          }
        })
        .catch(err => {
          this.toast('登录失败：' + err.response.data.msg)
          console.error(err)
        })
    },
    toast(text, color = 'error') {
      this.snackbar.text = text
      this.snackbar.color = color
    },
  }
}
</script>

<style>
.post {
  width: 100%;
  height: 160px;
  padding: 16px;
  font-size: 16px;
  border: none;
  resize: none;
}

.post:focus {
  outline: none;
}

.taghint {
  font-size: 12px;
  color: #666;
  margin-left: 8px;
}
</style>