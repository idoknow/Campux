<template>

  <BottomNavBar id="bnb" v-model="value" @input="go" />

  <div id="container-wrap" style="height: calc(100vh - 64px)">
    <div id="pctabs">
      <h2 style="text-align: center; background-color: #42A5F5; color: #fff; padding: 8px 0px">Campux</h2>
      <div
        style="display: flex; justify-content: space-between; flex-direction: column; align-items: center; height: 100%">
        <div>
          <div id="pctab-btn" @click="$router.push('/');">
            <span>📝 投稿</span>
          </div>
          <div id="pctab-btn" @click="$router.push('/world');">
            <span>🌏 稿件</span>
          </div>
          <div id="pctab-btn" @click="$router.push('/service');">
            <span style="font-weight: 1000">🛠 服务</span>
          </div>
          <div id="pctab-btn" v-if="userGroup === 'admin' || userGroup === 'member'" @click="$router.push('/admin');">
            <span>🔐 管理</span>
          </div>
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
      <div>
        <h2 id="mt" style="padding: 8px 16px; font-family: Lilita One; display: inline-block">Campux</h2>
        <span>{{ $store.state.metadata.brand }}</span>
      </div>
      <div style="padding: 16px;">

        <h1 style="margin-bottom: 16px">🎲 服务</h1>

        <h2 style="margin-top: 16px">🙂 账号服务</h2>
        <v-dialog max-width="500">
          <template v-slot:activator="{ props: activatorProps }">
            <div class="rect1" style="background-color: #2196F3;" v-bind="activatorProps">
              <div>
                <p style="font-weight: bold; font-size: 16px">修改密码</p>
              </div>
              <a style="font-size: 16px; cursor:pointer; font-weight: bold;">></a>
            </div>
          </template>

          <template v-slot:default="{ isActive }">
            <v-card title="修改密码">

              <v-card-text>
                <v-text-field variant="outlined" v-model="password" label="新密码" type="password"></v-text-field>
              </v-card-text>

              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text="取消" @click="isActive.value = false"></v-btn>
                <v-btn text="确认" @click="isActive.value = false; updatePassword()"></v-btn>
              </v-card-actions>
            </v-card>
          </template>
        </v-dialog>

        <v-dialog max-width="500">
          <template v-slot:activator="{ props: activatorProps }">
            <div class="rect1" style="background-color: #2196F3;" v-bind="activatorProps">
              <div>
                <p style="font-weight: bold; font-size: 16px">退出登录</p>
              </div>
              <a style="font-size: 16px; cursor:pointer; font-weight: bold;">></a>
            </div>
          </template>

          <template v-slot:default="{ isActive }">
            <v-card title="提示">

              <v-card-text>
                真的要退出吗？
              </v-card-text>

              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text="取消" @click="isActive.value = false"></v-btn>
                <v-btn text="确认" @click="isActive.value = false; logout()"></v-btn>
              </v-card-actions>
            </v-card>
          </template>
        </v-dialog>

        <h2 style="margin-top: 16px">🤩 推荐网站</h2>
        <div class="rect1" v-for="(service, index) in services" :style="service.color">
          <div>
            <p style="font-weight: bold; font-size: 16px">{{ service.emoji }} {{ service.name }}</p>
            <small style="color: #fff; font-size: 13px">{{ service.link }}</small>
          </div>
          <a style="font-size: 16px; cursor:pointer; font-weight: bold;"
            @click="selectedService = index; showServiceHint = true">点击查看</a>
        </div>

        <p style="text-align: center; margin-top: 16px; color: #c3c3c3">更多服务正在开发...</p>
      </div>


      <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout"
        style="margin-bottom: 64px">
        {{ snackbar.text }}
      </v-snackbar>

      <v-dialog v-model="showServiceHint" width="auto">
        <v-card :text="services[selectedService].toast" title="提示">
          <template v-slot:actions>
            <v-btn text="取消" @click="showServiceHint = false;"></v-btn>
            <v-btn class="ms-auto" text="确定"
              @click="showServiceHint = false; go(services[selectedService].link)"></v-btn>
          </template>
        </v-card>
      </v-dialog>

    </div>
  </div>

</template>

<script>
import BottomNavBar from '@/components/BottomNavBar.vue'

export default {
  components: {
    BottomNavBar
  },
  data() {
    return {
      showServiceHint: false,
      selectedService: -1,
      services: [],
      password: "",
      snackbar: {
        show: false,
        text: '',
        color: ''
      },
      value: 2,
      displayInnerWindow: '',
      avatarUrl: '',
      uin: '',
      userGroup: ''
    }
  },

  mounted() {
    this.tokenLogin()
    this.getMetadata_('services')
  },

  methods: {
    logout() {
      this.$cookies.remove('access-token')
      window.location.reload()
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
    randomColor() {
      let colors = ["#FFC107", "#42A5F5", "#9CCC65", "#F06292", "#76FF03", "#9E9E9E", "#8D6E63"]
      return colors[Math.floor(Math.random() * 100) % colors.length]
    },
    getMetadata_(key) {
      this.$axios.get('/v1/misc/get-metadata?key=' + key)
        .then(res => {
          if (res.data.code === 0) {
            this.services = JSON.parse(res.data.data.value)
            console.log(this.services)
            for (let i = 0; i < this.services.length; i++) {
              if (!this.services[i].toast) {
                this.services[i].toast = '点击确定跳转到 ' + this.services[i].link
              }
              this.services[i].color = "background-color: " + this.randomColor() + ";"
            }
          } else {
            this.toast('获取服务失败：' + res.data.msg)
          }
        })
        .catch(err => {
          this.toast('获取失败：' + err)
          console.error(err)
        })
    },
    toast(text, color = 'error') {
      this.snackbar.text = text
      this.snackbar.color = color
      this.snackbar.show = true
    },

    go(url) {
      // this.displayInnerWindow = url
      window.open(url, '_blank')
    },

    updatePassword() {
      if (this.password.length < 6) {
        this.toast('密码长度至少为6位')
        return
      }
      this.$axios.put('/v1/account/update-pwd', {
        "new_passwd": this.password
      })
        .then(res => {
          if (res.data.code === 0) {
            this.toast('密码修改成功', 'success')
          } else {
            this.toast('密码修改失败：' + res.data.msg)
          }
        })
        .catch(err => {
          this.toast('失败：' + err.response.data.msg)
          console.error(err)
        })
    }
  }
}

</script>

<style>
.rect1 {
  cursor: pointer;
  padding: 16px;
  font-size: 18px;
  border-radius: 7px;
  color: #fff;
  margin-top: 8px;
  width: 95%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.11);
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: box-shadow 0.2s;
}

.rect1:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

#container-wrap {
  min-height: 74vh;
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
    display: block;
    min-width: 200px;
  }

  #container-wrap {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  #container {
    height: 100%;
    margin-left: 16px;
    width: 60%;
  }

  #pctab-btn {
    padding: 12px 28px;
    margin-top: 16px;
    text-align: center;
    font-size: 18px;
    border-radius: 24px;
    cursor: pointer;
  }

  #pctab-btn:hover {
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