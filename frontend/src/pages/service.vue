<template>
  <div class="service-page-container">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="brand-section">
        <h1 class="brand-title">Campux</h1>
        <span class="brand-subtitle">{{ $store.state.metadata.brand }}</span>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 页面标题 -->
      <div class="page-title-section">
        <div class="title-content">
          <v-icon color="#3b82f6" size="32">mdi-cog</v-icon>
          <div class="title-text">
            <h1 class="page-title">服务中心</h1>
            <p class="page-subtitle">管理你的账号和探索更多服务</p>
          </div>
        </div>
      </div>

      <!-- 账号服务区域 -->
      <div class="service-section">
        <div class="section-header">
          <v-icon color="#10b981" size="20">mdi-account-cog</v-icon>
          <h2 class="section-title">账号服务</h2>
        </div>
        <div class="service-grid">
          <!-- 修改密码 -->
          <v-dialog max-width="500">
            <template v-slot:activator="{ props: activatorProps }">
              <div class="service-card password-card" v-bind="activatorProps">
                <div class="service-card-content">
                  <div class="service-icon">
                    <v-icon color="white" size="24">mdi-lock-reset</v-icon>
                  </div>
                  <div class="service-info">
                    <h3 class="service-title">修改密码</h3>
                    <p class="service-desc">更新你的账号密码</p>
                  </div>
                </div>
                <v-icon color="white" size="20">mdi-chevron-right</v-icon>
              </div>
            </template>

            <template v-slot:default="{ isActive }">
              <div class="modern-dialog">
                <div class="dialog-header">
                  <v-icon color="#3b82f6" size="24">mdi-lock-reset</v-icon>
                  <h3 class="dialog-title">修改密码</h3>
                </div>
                <div class="dialog-content">
                  <v-text-field
                    variant="outlined"
                    v-model="password"
                    label="新密码"
                    type="password"
                    class="modern-input">
                  </v-text-field>
                </div>
                <div class="dialog-actions">
                  <v-btn class="dialog-btn cancel-btn" @click="isActive.value = false">取消</v-btn>
                  <v-btn class="dialog-btn confirm-btn" @click="isActive.value = false; updatePassword()">确认</v-btn>
                </div>
              </div>
            </template>
          </v-dialog>

          <!-- 退出登录 -->
          <v-dialog max-width="500">
            <template v-slot:activator="{ props: activatorProps }">
              <div class="service-card logout-card" v-bind="activatorProps">
                <div class="service-card-content">
                  <div class="service-icon">
                    <v-icon color="white" size="24">mdi-logout</v-icon>
                  </div>
                  <div class="service-info">
                    <h3 class="service-title">退出登录</h3>
                    <p class="service-desc">安全退出当前账号</p>
                  </div>
                </div>
                <v-icon color="white" size="20">mdi-chevron-right</v-icon>
              </div>
            </template>

            <template v-slot:default="{ isActive }">
              <div class="modern-dialog">
                <div class="dialog-header">
                  <v-icon color="#ef4444" size="24">mdi-logout</v-icon>
                  <h3 class="dialog-title">退出登录</h3>
                </div>
                <div class="dialog-content">
                  <p class="dialog-message">确定要退出登录吗？退出后需要重新登录才能使用。</p>
                </div>
                <div class="dialog-actions">
                  <v-btn class="dialog-btn cancel-btn" @click="isActive.value = false">取消</v-btn>
                  <v-btn class="dialog-btn danger-btn" @click="isActive.value = false; logout()">确认退出</v-btn>
                </div>
              </div>
            </template>
          </v-dialog>
        </div>
      </div>

      <!-- 推荐服务区域 -->
      <div class="service-section">
        <div class="section-header">
          <v-icon color="#f59e0b" size="20">mdi-star</v-icon>
          <h2 class="section-title">推荐服务</h2>
        </div>
        <div class="recommended-services">
          <div v-if="services.length === 0" class="empty-state">
            <v-icon color="#94a3b8" size="48">mdi-web</v-icon>
            <h3 class="empty-title">暂无推荐服务</h3>
            <p class="empty-desc">更多精彩服务正在开发中...</p>
          </div>
          <div v-else class="services-grid">
            <div v-for="(service, index) in services"
                 :key="index"
                 class="recommended-card"
                 @click="selectedService = index; showServiceHint = true">
              <div class="recommended-card-header">
                <div class="service-emoji">{{ service.emoji }}</div>
                <v-icon color="#6b7280" size="16">mdi-open-in-new</v-icon>
              </div>
              <div class="recommended-card-content">
                <h3 class="recommended-title">{{ service.name }}</h3>
                <p class="recommended-url">{{ service.link }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 开发中提示 -->
      <div class="development-notice">
        <v-icon color="#94a3b8" size="20">mdi-hammer-wrench</v-icon>
        <span class="notice-text">更多服务正在开发中，敬请期待...</span>
      </div>
    </div>


    <!-- 通知栏 -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout"
                class="modern-snackbar" style="margin-bottom: 64px">
      {{ snackbar.text }}
    </v-snackbar>

    <!-- 服务确认对话框 -->
    <v-dialog v-model="showServiceHint" max-width="400">
      <div class="modern-dialog" v-if="selectedService >= 0">
        <div class="dialog-header">
          <v-icon color="#3b82f6" size="24">mdi-open-in-new</v-icon>
          <h3 class="dialog-title">打开外部链接</h3>
        </div>
        <div class="dialog-content">
          <p class="dialog-message">{{ services[selectedService]?.toast || '即将跳转到外部网站，请确认是否继续？' }}</p>
        </div>
        <div class="dialog-actions">
          <v-btn class="dialog-btn cancel-btn" @click="showServiceHint = false">取消</v-btn>
          <v-btn class="dialog-btn confirm-btn" @click="showServiceHint = false; go(services[selectedService].link)">确定</v-btn>
        </div>
      </div>
    </v-dialog>
  </div>


</template>

<script>
export default {
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
    }
  },

  mounted() {
    this.getMetadata_('services')
  },

  methods: {
    logout() {
      this.$cookies.remove('access-token')
      window.location.reload()
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

<style scoped>
/* 服务页面整体布局 */
.service-page-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
  display: flex;
  flex-direction: column;
}

/* 页面头部 */
.page-header {
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 16px 20px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand-section {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.brand-title {
  font-family: 'Lilita One', cursive;
  font-size: 28px;
  font-weight: 400;
  color: #1e293b;
  margin: 0;
}

.brand-subtitle {
  color: #64748b;
  font-size: 14px;
  font-weight: 500;
}

/* 主要内容区域 */
.main-content {
  flex: 1;
  max-width: 600px;
  margin: 0 auto;
  width: 100%;
  padding: 20px;
}

/* 页面标题区域 */
.page-title-section {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  padding: 24px;
  margin-bottom: 20px;
}

.title-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.title-text {
  flex: 1;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.page-subtitle {
  color: #64748b;
  font-size: 14px;
  margin: 0;
}

/* 服务区域 */
.service-section {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  border-bottom: 1px solid #f1f5f9;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

/* 服务网格 */
.service-grid {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 服务卡片 */
.service-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: white;
}

.service-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

.password-card {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
}

.logout-card {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}

.service-card-content {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.service-icon {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.service-info {
  flex: 1;
}

.service-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px 0;
  color: white;
}

.service-desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  margin: 0;
}

/* 推荐服务 */
.recommended-services {
  padding: 20px;
}

.services-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.recommended-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.recommended-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
  transform: translateY(-2px);
}

.recommended-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.service-emoji {
  font-size: 24px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
  border-radius: 10px;
}

.recommended-card-content {
  flex: 1;
}

.recommended-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.recommended-url {
  font-size: 13px;
  color: #64748b;
  margin: 0;
  word-break: break-all;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 60px 20px;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #64748b;
  margin: 16px 0 8px;
}

.empty-desc {
  color: #94a3b8;
  font-size: 14px;
  margin: 0;
}

/* 开发中提示 */
.development-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  background: rgba(148, 163, 184, 0.1);
  border-radius: 12px;
  margin-top: 20px;
}

.notice-text {
  color: #64748b;
  font-size: 14px;
  font-style: italic;
}

/* 现代化对话框 */
.modern-dialog {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  border-bottom: 1px solid #f1f5f9;
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.dialog-content {
  padding: 20px;
}

.dialog-message {
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.modern-input {
  margin-top: 8px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  background: #f8fafc;
}

.dialog-btn {
  border-radius: 8px !important;
  font-weight: 500 !important;
  text-transform: none !important;
  padding: 0 20px !important;
  height: 36px !important;
}

.cancel-btn {
  color: #64748b !important;
  border: 1px solid #e2e8f0 !important;
}

.confirm-btn {
  background: #3b82f6 !important;
  color: white !important;
}

.danger-btn {
  background: #ef4444 !important;
  color: white !important;
}

/* 通知样式 */
.modern-snackbar :deep(.v-snackbar__wrapper) {
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.modern-snackbar :deep(.v-snackbar__content) {
  border-radius: 16px;
  padding: 12px 16px;
  font-weight: 500;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .page-header {
    padding: 12px 16px;
  }

  .brand-title {
    font-size: 24px;
  }

  .brand-subtitle {
    font-size: 13px;
  }

  .main-content {
    padding: 16px;
  }

  .page-title-section {
    padding: 20px;
    margin-bottom: 16px;
  }

  .title-content {
    gap: 12px;
  }

  .page-title {
    font-size: 20px;
  }

  .page-subtitle {
    font-size: 13px;
  }

  .service-section {
    margin-bottom: 16px;
  }

  .section-header {
    padding: 16px;
  }

  .section-title {
    font-size: 16px;
  }

  .service-grid {
    padding: 16px;
  }

  .service-card {
    padding: 14px 16px;
  }

  .service-icon {
    width: 44px;
    height: 44px;
  }

  .service-title {
    font-size: 15px;
  }

  .service-desc {
    font-size: 12px;
  }

  .recommended-services {
    padding: 16px;
  }

  .services-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .recommended-card {
    padding: 16px;
  }

  .service-emoji {
    width: 36px;
    height: 36px;
    font-size: 20px;
  }

  .recommended-title {
    font-size: 15px;
  }

  .recommended-url {
    font-size: 12px;
  }

  .empty-state {
    padding: 40px 16px;
  }

  .empty-title {
    font-size: 16px;
  }

  .empty-desc {
    font-size: 13px;
  }

  .development-notice {
    padding: 12px;
    margin-top: 16px;
  }

  .notice-text {
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .page-header {
    padding: 10px 12px;
  }

  .brand-title {
    font-size: 22px;
  }

  .main-content {
    padding: 12px;
  }

  .page-title-section {
    padding: 16px;
    margin-bottom: 12px;
  }

  .page-title {
    font-size: 18px;
  }

  .service-section {
    margin-bottom: 12px;
  }

  .section-header {
    padding: 14px;
  }

  .service-grid {
    padding: 14px;
    gap: 10px;
  }

  .service-card {
    padding: 12px 14px;
  }

  .service-card-content {
    gap: 12px;
  }

  .service-icon {
    width: 40px;
    height: 40px;
  }

  .service-title {
    font-size: 14px;
  }

  .service-desc {
    font-size: 11px;
  }

  .recommended-services {
    padding: 14px;
  }

  .recommended-card {
    padding: 14px;
  }

  .service-emoji {
    width: 32px;
    height: 32px;
    font-size: 18px;
  }

  .recommended-title {
    font-size: 14px;
  }

  .recommended-url {
    font-size: 11px;
  }

  .dialog-header {
    padding: 16px;
  }

  .dialog-content {
    padding: 16px;
  }

  .dialog-actions {
    padding: 12px 16px;
  }

  .dialog-btn {
    height: 32px !important;
    padding: 0 16px !important;
  }
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