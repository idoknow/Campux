<template>

  <!-- 左侧导航栏 -->
  <div id="container-wrap" style="height: calc(100vh - 64px)">
    <div id="pctabs">
      <h2 style="text-align: center; background-color: #42A5F5; color: #fff; padding: 8px 0px">Campux</h2>
      <div
        style="display: flex; justify-content: space-between; flex-direction: column; align-items: center; height: 100%">
        <div>
          <RouterLink to="/">
            <div class="pctab-btn">
              <span>📝 投稿</span>
            </div>
          </RouterLink>

          <RouterLink to="/world">
            <div class="pctab-btn">
              <span>🌏 稿件</span>
            </div>
          </RouterLink>

          <RouterLink to="/service">
            <div class="pctab-btn">
              <span>🛠 服务</span>
            </div>
          </RouterLink>
          
          <RouterLink v-if="userGroup === 'admin' || userGroup === 'member'"  to="/admin">
            <div class="pctab-btn">
              <span>🔐 管理</span>
            </div>
          </RouterLink>
        </div>

        <div style="display: flex;">
          <img :src="avatarUrl" width="50" height="50" style="border-radius: 50%;">
          <div>
            <p style="margin-left: 16px; font-size: 16px; font-weight: bold;">{{ uin }}</p>
            <p style="margin-left: 16px; font-size: 12px; color: #666;">{{ userGroup }}</p>
          </div>
        </div>
      </div>

    </div>

    <!-- 纵向分割线 -->
    <div id="vdivider" style="height: calc(100vh - 64px); width: 1px; background-color: #f5f5f5;">
    </div>

    <div id="container">
      <RouterView />
    </div>
  </div>

  <BottomNavBar id="bnb" v-model="value" />


</template>

<script>
import BottomNavBar from '@/components/BottomNavBar.vue'

export default {
  components: {
    BottomNavBar
  },
  data() {
    return {
      value: 0,
      loading: false,
      userGroup: ''
    }
  },

  mounted() {
    this.tokenLogin()
    this.$store.commit('initMetadata', 'banner')
    this.$store.commit('initMetadata', 'brand')
    this.$store.commit('initMetadata', 'popup_announcement')
    this.$store.commit('initMetadata', 'post_rules')
    this.$store.commit('initMetadata', 'beianhao')
    console.log(this.$store.state.metadata)

  },

  methods: {
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
    toast(text, color = 'error') {
      this.snackbar.text = text
      this.snackbar.color = color
      this.snackbar.show = true
    },
  }
}
</script>

<style>
button {
  border: none;
  border-radius: 20px;
  background: linear-gradient(32deg, #03a9f4, #f441a5, #ffeb3b, #03a9f4);
  transition: all 1.5s ease;
  font-family: 'Ropa Sans', sans-serif;
  font-weight: bold;
  letter-spacing: 0.05rem;
  padding: 0;
}


/* 适配pc端 */
@media (min-width: 600px) {

  #mt {
    display: none;
  }

  #bnb {
    display: none;
  }

  #pctabs {
    height: 100%;
    display: block;
    min-width: 200px;
  }

  #container-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  #container {
    margin-left: 0px;
    height: 100%;
    width: 60%;
  }

  .pctab-btn {
    padding: 12px 28px;
    margin-top: 16px;
    text-align: center;
    font-size: 18px;
    border-radius: 24px;
    cursor: pointer;
    text-decoration: none;
    color: black;
  }

  a{
    text-decoration: none;
    color: black;
  }

  .pctab-btn:hover {
    background-color: #f5f5f5;
  }

  #vdivider {
    display: block;
  }
}

/* 适配移动端 */
@media (max-width: 600px) {
  #tabs {
    display: block;
  }

  #pctabs {
    display: none;
  }

  #vdivider {
    display: none;
  }

}
</style>