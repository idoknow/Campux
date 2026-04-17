<template>
  <div class="modern-init-container">
    <!-- 动态背景 -->
    <div class="animated-background">
      <div class="gradient-orb orb-1"></div>
      <div class="gradient-orb orb-2"></div>
      <div class="gradient-orb orb-3"></div>
    </div>

    <!-- 主要内容 -->
    <div class="main-content">
      <!-- 品牌区域 -->
      <div class="brand-section">
        <div class="brand-logo">
          <div class="logo-wrapper">
            <div class="logo-inner">
              <span class="logo-icon">🎯</span>
            </div>
          </div>
        </div>
        <h1 class="brand-title">Campux</h1>
        <p class="brand-subtitle">校园墙管理系统</p>
      </div>

      <!-- 注册卡片 -->
      <div class="register-card">
        <div class="card-header">
          <h2 class="card-title">创建管理员账户</h2>
          <p class="card-subtitle">设置您的第一个管理员账户</p>
        </div>

        <div class="card-body">
          <div class="input-group">
            <div class="input-wrapper">
              <v-text-field
                v-model="credientials.admin_uin"
                label="QQ 号"
                variant="solo"
                prepend-inner-icon="mdi-account-outline"
                placeholder="请输入您的QQ号"
                class="modern-input"
                hide-details
              ></v-text-field>
            </div>
          </div>

          <div class="input-group">
            <div class="input-wrapper">
              <v-text-field
                v-model="credientials.admin_passwd"
                label="密码"
                type="password"
                variant="solo"
                prepend-inner-icon="mdi-lock-outline"
                placeholder="请设置登录密码"
                class="modern-input"
                hide-details
              ></v-text-field>
            </div>
          </div>

          <div class="button-group">
            <v-btn
              class="register-btn"
              :loading="loading"
              @click="doInitialize"
              block
            >
              <span class="btn-text">开始使用</span>
            </v-btn>
          </div>
        </div>
      </div>

      <!-- 底部信息 -->
      <div class="footer-info">
        <p class="copyright">© 2025 Campux - 让校园生活更美好</p>
      </div>
    </div>

    <!-- 通知 -->
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="snackbar.timeout"
      location="top"
      class="modern-snackbar"
    >
      <div class="snackbar-content">
        <v-icon class="snackbar-icon">
          {{ snackbar.color === 'success' ? 'mdi-check-circle' : 'mdi-alert-circle' }}
        </v-icon>
        <span>{{ snackbar.text }}</span>
      </div>
    </v-snackbar>
  </div>
</template>

<script>


export default {
    data() {
        return {
            credientials: {
                admin_uin: '',
                admin_passwd: ''
            },
            authTitle: '初始化管理员账户',
            loading: false,
            snackbar: {
                show: false,
                text: '',
                color: '',
                timeout: 4000
            },
            rules: {
                required: value => !!value || '此字段为必填项',
                qqNumber: value => {
                    const pattern = /^\d{5,11}$/
                    return pattern.test(value) || 'QQ号格式不正确（5-11位数字）'
                },
                minLength: value => (value && value.length >= 6) || '密码至少6位字符'
            }
        }
    },

    mounted() {

        // get param
        if (this.$route.query.hint) {
            this.toast(this.$route.query.hint)
        }
    },

    methods: {
        doInitialize() {
            // 表单验证
            if (!this.validateForm()) {
                return
            }

            this.loading = true

            // 转换QQ号为数字
            const credentials = {
                admin_uin: parseInt(this.credientials.admin_uin),
                admin_passwd: this.credientials.admin_passwd
            }

            this.$axios.post('/v1/admin/init', credentials)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('🎉 初始化成功！正在跳转到登录页面...', 'success')

                        // 延迟跳转，让用户看到成功消息
                        setTimeout(() => {
                            this.$router.push('/auth?hint=初始化成功，请使用刚才设置的账号密码登录。')
                        }, 2000)
                    } else {
                        this.toast('❌ 初始化失败：' + res.data.msg, 'error')
                    }
                })
                .catch(err => {
                    const errorMsg = err.response?.data?.msg || '网络连接失败，请检查后端服务'
                    this.toast('❌ 初始化失败：' + errorMsg, 'error')
                    console.error('初始化错误:', err)
                })
                .finally(() => {
                    this.loading = false
                })
        },

        validateForm() {
            // 检查必填字段
            if (!this.credientials.admin_uin || !this.credientials.admin_passwd) {
                this.toast('⚠️ 请填写完整的账号信息', 'warning')
                return false
            }

            // 验证QQ号格式
            const qqPattern = /^\d{5,11}$/
            if (!qqPattern.test(this.credientials.admin_uin)) {
                this.toast('⚠️ QQ号格式不正确（应为5-11位数字）', 'warning')
                return false
            }

            // 验证密码长度
            if (this.credientials.admin_passwd.length < 6) {
                this.toast('⚠️ 密码至少需要6位字符', 'warning')
                return false
            }

            return true
        },

        toast(text, color = 'error') {
            this.snackbar.text = text
            this.snackbar.color = color
            this.snackbar.show = true
        },
    }
}
</script>

<style scoped>
.modern-init-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #1e3c72 0%, #2a5298 50%, #667eea 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  position: relative;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

.animated-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 1;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.7;
  animation: float-orb 20s ease-in-out infinite;
}

.orb-1 {
  width: 300px;
  height: 300px;
  background: linear-gradient(45deg, #ff6b6b, #feca57);
  top: -150px;
  left: -150px;
  animation-delay: 0s;
}

.orb-2 {
  width: 200px;
  height: 200px;
  background: linear-gradient(45deg, #48cae4, #023e8a);
  top: 50%;
  right: -100px;
  animation-delay: 7s;
}

.orb-3 {
  width: 250px;
  height: 250px;
  background: linear-gradient(45deg, #a8e6cf, #3d5a80);
  bottom: -125px;
  left: 30%;
  animation-delay: 14s;
}

@keyframes float-orb {
  0%, 100% {
    transform: translateY(0px) translateX(0px) scale(1);
  }
  33% {
    transform: translateY(-30px) translateX(20px) scale(1.1);
  }
  66% {
    transform: translateY(20px) translateX(-15px) scale(0.9);
  }
}

.main-content {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  justify-content: center;
}

.brand-section {
  text-align: center;
  margin-bottom: 2rem;
  color: white;
}

.brand-logo {
  margin-bottom: 1.5rem;
}

.logo-wrapper {
  position: relative;
  display: inline-block;
}

.logo-inner {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, #ffffff20, #ffffff10);
  backdrop-filter: blur(20px);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  animation: gentle-float 3s ease-in-out infinite;
}

@keyframes gentle-float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}

.logo-icon {
  font-size: 2rem;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));
}

.brand-title {
  font-size: 2.8rem;
  font-weight: 800;
  margin-bottom: 0.5rem;
  background: linear-gradient(135deg, #ffffff, #e3f2fd);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.02em;
  text-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.brand-subtitle {
  font-size: 1rem;
  opacity: 0.9;
  font-weight: 400;
  letter-spacing: 0.5px;
}

.register-card {
  width: 100%;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.1),
    0 1px 0 rgba(255, 255, 255, 0.2) inset;
  overflow: hidden;
}

.card-header {
  padding: 2rem 2rem 1rem;
  text-align: center;
  background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
}

.card-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 0.5rem;
  letter-spacing: -0.01em;
}

.card-subtitle {
  font-size: 0.9rem;
  color: #666;
  font-weight: 400;
  opacity: 0.8;
}

.card-body {
  padding: 1rem 2rem 2rem;
}

.input-group {
  margin-bottom: 1.5rem;
}

.input-wrapper {
  position: relative;
}

.modern-input :deep(.v-field) {
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(226, 232, 240, 0.8);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.1),
    0 1px 2px rgba(0, 0, 0, 0.06);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.modern-input :deep(.v-field--focused) {
  border-color: #3b82f6;
  box-shadow:
    0 0 0 3px rgba(59, 130, 246, 0.1),
    0 1px 3px rgba(0, 0, 0, 0.1);
}

.modern-input :deep(.v-field__input) {
  padding: 12px 20px;
  font-size: 1rem;
  color: #1f2937;
  font-weight: 500;
  margin-top: 4px;
}

.modern-input :deep(.v-field__prepend-inner) {
  padding-left: 16px;
  color: #6b7280;
}

.modern-input :deep(.v-label) {
  color: #6b7280;
  font-weight: 500;
  font-size: 0.9rem;
  transform: translateY(-8px);
}

.modern-input :deep(.v-field--focused .v-label) {
  color: #3b82f6;
}

.modern-input :deep(.v-field--active .v-label) {
  transform: translateY(-12px) scale(0.85);
}

.button-group {
  margin-top: 1rem;
}

.register-btn {
  height: 48px;
  border-radius: 16px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  font-size: 1rem;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0.025em;
  box-shadow:
    0 4px 14px rgba(59, 130, 246, 0.4),
    0 2px 4px rgba(0, 0, 0, 0.1);
  transition: background 0.3s ease, box-shadow 0.3s ease;
  border: none;
}



.register-btn:active {
  background: linear-gradient(135deg, #1d4ed8, #1e3a8a);
}

.btn-text {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.footer-info {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: center;
  padding: 1rem 0;
  z-index: 10;
  background: linear-gradient(to top, rgba(30, 60, 114, 0.8), transparent);
  backdrop-filter: blur(10px);
}

.copyright {
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.85rem;
  font-weight: 400;
  margin: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.modern-snackbar {
  z-index: 9999;
}

.snackbar-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.snackbar-icon {
  font-size: 1.2rem;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .modern-init-container {
    padding: 15px 15px 80px;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
  }

  .main-content {
    max-width: 100%;
    justify-content: center;
  }

  .brand-section {
    margin-bottom: 1.5rem;
  }

  .logo-inner {
    width: 60px;
    height: 60px;
  }

  .logo-icon {
    font-size: 1.5rem;
  }

  .brand-title {
    font-size: 2.2rem;
  }

  .brand-subtitle {
    font-size: 0.9rem;
  }

  .card-header {
    padding: 1.5rem 1.5rem 0.5rem;
  }

  .card-body {
    padding: 1rem 1.5rem 1.5rem;
  }

  .card-title {
    font-size: 1.3rem;
  }

  .card-subtitle {
    font-size: 0.85rem;
  }

  .input-group {
    margin-bottom: 1.2rem;
  }

  .register-btn {
    height: 44px;
    font-size: 0.95rem;
  }

  .gradient-orb {
    filter: blur(40px);
    opacity: 0.5;
  }

  .orb-1 {
    width: 200px;
    height: 200px;
  }

  .orb-2 {
    width: 150px;
    height: 150px;
  }

  .orb-3 {
    width: 180px;
    height: 180px;
  }

  .footer-info {
    padding: 0.8rem 0;
  }

  .copyright {
    font-size: 0.8rem;
  }
}

@media (max-height: 700px) {
  .modern-init-container {
    justify-content: center;
    align-items: center;
    padding: 15px 15px 80px;
  }

  .brand-section {
    margin-bottom: 1rem;
  }

  .logo-inner {
    width: 50px;
    height: 50px;
  }

  .brand-title {
    font-size: 2rem;
  }
}

@media (max-width: 480px) {
  .modern-init-container {
    padding: 10px 10px 80px;
    justify-content: center;
    align-items: center;
  }

  .main-content {
    justify-content: center;
  }

  .card-header {
    padding: 1rem 1rem 0.5rem;
  }

  .card-body {
    padding: 0.5rem 1rem 1rem;
  }

  .modern-input :deep(.v-field__input) {
    padding: 10px 16px;
    font-size: 0.95rem;
  }
}

/* 深色模式适配 */
@media (prefers-color-scheme: dark) {
  .init-card {
    background: rgba(30, 30, 30, 0.95) !important;
    color: white;
  }
}
</style>