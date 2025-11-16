<template>
  <div class="modern-auth-container">
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

      <!-- 登录卡片 -->
      <div class="auth-card" v-if="!showOAuth2">
        <div class="card-header">
          <h2 class="card-title">{{ authTitle }}</h2>
          <p class="card-subtitle">使用您的账号登录系统</p>
        </div>

        <div class="card-body">
          <div class="input-group">
            <div class="input-wrapper">
              <v-text-field
                v-model="credientials.uin"
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
                v-model="credientials.passwd"
                label="密码"
                type="password"
                variant="solo"
                prepend-inner-icon="mdi-lock-outline"
                placeholder="请输入您的密码"
                class="modern-input"
                hide-details
              ></v-text-field>
            </div>
          </div>

          <div class="help-links">
            <v-dialog max-width="500">
              <template v-slot:activator="{ props: activatorProps }">
                <span v-bind="activatorProps" class="help-link">没有账号？</span>
              </template>
              <template v-slot:default="{ isActive }">
                <div class="modern-dialog-wrapper">
                  <div class="modern-dialog">
                    <div class="dialog-header">
                      <div class="dialog-icon">
                        <v-icon size="24" color="#3b82f6">mdi-account-plus</v-icon>
                      </div>
                      <h3 class="dialog-title-text">注册账号</h3>
                    </div>

                    <div class="dialog-body">
                      <p class="dialog-description">请给墙号发送以下指令来注册账号：</p>

                      <div class="command-container">
                        <div class="command-label">发送指令</div>
                        <div class="command-box">
                          <code>#注册账号</code>
                          <v-icon class="copy-icon" size="16" color="#6b7280">mdi-content-copy</v-icon>
                        </div>
                      </div>

                      <div class="info-box">
                        <v-icon class="info-icon" size="16" color="#10b981">mdi-check-circle</v-icon>
                        <span>系统将自动为您生成初始密码</span>
                      </div>
                    </div>

                    <div class="dialog-footer">
                      <v-btn
                        class="modern-dialog-btn"
                        @click="isActive.value = false"
                        variant="flat"
                      >
                        <v-icon class="mr-1" size="16">mdi-check</v-icon>
                        知道了
                      </v-btn>
                    </div>
                  </div>
                </div>
              </template>
            </v-dialog>

            <span class="separator">|</span>

            <v-dialog max-width="500">
              <template v-slot:activator="{ props: activatorProps }">
                <span v-bind="activatorProps" class="help-link">忘记密码？</span>
              </template>
              <template v-slot:default="{ isActive }">
                <div class="modern-dialog-wrapper">
                  <div class="modern-dialog">
                    <div class="dialog-header">
                      <div class="dialog-icon">
                        <v-icon size="24" color="#f59e0b">mdi-key-variant</v-icon>
                      </div>
                      <h3 class="dialog-title-text">重置密码</h3>
                    </div>

                    <div class="dialog-body">
                      <p class="dialog-description">请给墙号发送以下指令来重置密码：</p>

                      <div class="command-container">
                        <div class="command-label">发送指令</div>
                        <div class="command-box">
                          <code>#重置密码</code>
                          <v-icon class="copy-icon" size="16" color="#6b7280">mdi-content-copy</v-icon>
                        </div>
                      </div>

                      <div class="info-box">
                        <v-icon class="info-icon" size="16" color="#f59e0b">mdi-alert-circle</v-icon>
                        <span>系统将为您重置为随机密码</span>
                      </div>
                    </div>

                    <div class="dialog-footer">
                      <v-btn
                        class="modern-dialog-btn"
                        @click="isActive.value = false"
                        variant="flat"
                      >
                        <v-icon class="mr-1" size="16">mdi-check</v-icon>
                        知道了
                      </v-btn>
                    </div>
                  </div>
                </div>
              </template>
            </v-dialog>
          </div>

          <div class="button-group">
            <v-btn
              class="login-btn"
              :loading="loading"
              @click="login"
              block
            >
              <span class="btn-text">登录</span>
            </v-btn>
          </div>
        </div>
      </div>

      <!-- OAuth2 授权卡片 -->
      <div class="auth-card" v-else>
        <div class="card-header">
          <h2 class="card-title">授权确认</h2>
          <p class="card-subtitle">允许此应用访问您的 Campux 账号信息？</p>
        </div>

        <div class="card-body">
          <div class="oauth-scopes">
            <v-chip
              v-for="scope in currentSupportedScopes"
              :key="scope"
              color="primary"
              variant="tonal"
              class="scope-chip"
            >
              {{ scope }}
            </v-chip>
          </div>

          <div class="button-group">
            <v-btn
              class="oauth-btn"
              @click="doAuthorize"
              block
            >
              <span class="btn-text">授权</span>
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
                uin: '',
                passwd: ''
            },
            authTitle: '欢迎回来',
            loading: false,
            snackbar: {
                show: false,
                text: '',
                color: '',
                timeout: 4000
            },
            showOAuth2: false,
            authorizingAppInfo: {
                name: '',
                emoji: '🥰',
            },

            currentSupportedScopes: [
                '读取 UIN',
                '读取 注册时间',
                '读取 用户组',
            ]
        }
    },

    mounted() {

        // get param
        if (this.$route.query.hint) {
            this.toast(this.$route.query.hint)
        }
        this.$bus.on(
            'tokenCheckSuccess',
            () => {
                console.log('token check success')
                // oauth2 authorizing
                if (this.$route.query.client_id && this.$route.query.redirect_uri) {
                    this.$store.state.authMode = "oauth2"
                    // 获取app信息
                    this.$axios.get('/v1/oauth2/get-app-info?client_id=' + this.$route.query.client_id)
                        .then(res => {
                            if (res.data.code === 0) {
                                console.log(res.data.data)
                                this.authorizingAppInfo = res.data.data
                                this.authTitle = '🔒 授权 ' + this.authorizingAppInfo.name
                                this.showOAuth2 = true
                            } else {
                                this.toast('获取应用信息失败：' + res.data.msg)
                            }
                        })
                        .catch(err => {
                            this.toast('获取应用信息失败：' + err.response.data.msg)
                        })
                } else {
                    this.$router.push('/')
                }
            }
        )
    },

    methods: {
        resetPassword() {
            console.log('reset password')
        },

        login() {
            if (!this.credientials.uin || !this.credientials.passwd) {
                this.toast('请输入QQ号和密码', 'warning')
                return
            }

            let testuin = parseInt(this.credientials.uin)
            if (isNaN(testuin) || testuin < 10000 || testuin > 9999999999) {
                this.toast('请输入有效的QQ号', 'warning')
                return
            }

            this.credientials.uin = testuin
            this.loading = true

            this.$axios.post('/v1/account/login', this.credientials)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('登录成功！正在跳转...', 'success')
                        this.$store.commit('tokenCheck', this.$bus)
                        // save token to local storage
                        localStorage.setItem('access-token', res.data.data.token)

                        // 延迟跳转，让用户看到成功消息
                        setTimeout(() => {
                            this.$router.push('/')
                        }, 1000)
                    } else {
                        this.toast('登录失败：' + res.data.msg, 'error')
                    }
                })
                .catch(err => {
                    this.toast('登录失败：' + (err.response?.data?.msg || '网络错误'), 'error')
                    console.error(err)
                })
                .finally(() => {
                    this.loading = false
                })
        },

        toast(text, color = 'info') {
            this.snackbar.text = text
            this.snackbar.color = color
            this.snackbar.show = true
        },
        doAuthorize() {
            this.$axios.get('/v1/oauth2/authorize', {
                    params: {
                        client_id: this.$route.query.client_id,
                    }
                })
                .then(res => {
                    if (res.data.code === 0) {

                        let targetUri = this.$route.query.redirect_uri + '?code=' + res.data.data.code
                        if (this.$route.query.state) {
                            targetUri += '&state=' + this.$route.query.state
                        }

                        this.toast('授权成功，即将跳转到应用', 'success')

                        //等待2秒
                        setTimeout(() => {
                            window.location.href = targetUri
                        }, 2000)

                    } else {
                        this.toast('授权失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('授权失败：' + err.response.data.msg)
                })
        }
    }
}

</script>

<style scoped>
/* 主容器 */
.modern-auth-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  position: relative;
  overflow: hidden;
  flex-direction: column;
}

/* 动态背景 */
.animated-background {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
}

.gradient-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.6;
  animation: float 6s ease-in-out infinite;
}

.orb-1 {
  width: 300px;
  height: 300px;
  background: linear-gradient(45deg, #ff6b6b, #feca57);
  top: 10%;
  left: 10%;
  animation-delay: 0s;
}

.orb-2 {
  width: 200px;
  height: 200px;
  background: linear-gradient(45deg, #48cae4, #023e8a);
  top: 60%;
  right: 20%;
  animation-delay: 2s;
}

.orb-3 {
  width: 250px;
  height: 250px;
  background: linear-gradient(45deg, #a8e6cf, #3d5a80);
  bottom: 20%;
  left: 30%;
  animation-delay: 4s;
}

@keyframes float {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  33% { transform: translateY(-20px) rotate(120deg); }
  66% { transform: translateY(10px) rotate(240deg); }
}

@keyframes gentle-float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

/* 主要内容 */
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

/* 品牌区域 */
.brand-section {
  text-align: center;
  margin-bottom: 2rem;
}

.brand-logo {
  margin-bottom: 1rem;
}

.logo-wrapper {
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

.logo-icon {
  font-size: 2rem;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.brand-title {
  font-size: 2.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, #ffffff, #e2e8f0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0.5rem 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.brand-subtitle {
  color: rgba(255, 255, 255, 0.8);
  font-size: 1rem;
  font-weight: 400;
  margin: 0;
}

/* 认证卡片 */
.auth-card {
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
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(147, 197, 253, 0.05));
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

/* 现代输入框样式 */
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

/* 帮助链接 */
.help-links {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 2rem;
  font-size: 0.85rem;
}

.help-link {
  color: #3b82f6;
  cursor: pointer;
  transition: color 0.3s ease;
  text-decoration: none;
}



.separator {
  color: #d1d5db;
  font-weight: 300;
}

/* 按钮组 */
.button-group {
  margin-top: 1.5rem;
}

.login-btn, .oauth-btn {
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



.login-btn:active, .oauth-btn:active {
  background: linear-gradient(135deg, #1d4ed8, #1e3a8a);
}

.btn-text {
  font-weight: 600;
}

/* OAuth 作用域 */
.oauth-scopes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 2rem;
  justify-content: center;
}

.scope-chip {
  font-size: 0.85rem;
  font-weight: 500;
}

/* 现代化对话框样式 */
.modern-dialog-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.modern-dialog {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    0 25px 50px rgba(0, 0, 0, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  overflow: hidden;
  width: 100%;
  max-width: 420px;
  margin: 20px;
}

.dialog-header {
  background: linear-gradient(135deg, #f8fafc, #e2e8f0);
  padding: 2rem 2rem 1.5rem;
  text-align: center;
  border-bottom: 1px solid rgba(226, 232, 240, 0.5);
}

.dialog-icon {
  width: 56px;
  height: 56px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.dialog-title-text {
  font-size: 1.25rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
  letter-spacing: -0.01em;
}

.dialog-body {
  padding: 2rem;
}

.dialog-description {
  color: #4b5563;
  font-size: 0.95rem;
  line-height: 1.6;
  margin: 0 0 1.5rem 0;
  text-align: center;
}

.command-container {
  margin-bottom: 1.5rem;
}

.command-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.command-box {
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
  border: 2px solid rgba(59, 130, 246, 0.2);
  border-radius: 16px;
  padding: 1rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: all 0.3s ease;
  cursor: pointer;
}



.command-box code {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 1rem;
  font-weight: 700;
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
  padding: 6px 12px;
  border-radius: 8px;
  letter-spacing: 0.5px;
  flex: 1;
  text-align: center;
}

.copy-icon {
  opacity: 0.6;
  transition: opacity 0.3s ease;
}



.info-box {
  background: rgba(16, 185, 129, 0.05);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 12px;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #065f46;
}

.info-icon {
  flex-shrink: 0;
}

.dialog-footer {
  background: rgba(248, 250, 252, 0.8);
  padding: 1.5rem 2rem;
  text-align: center;
  border-top: 1px solid rgba(226, 232, 240, 0.5);
}

.modern-dialog-btn {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  border-radius: 12px;
  padding: 12px 32px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0.025em;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
  transition: all 0.3s ease;
  border: none;
}



/* 弹窗移动端适配 */
@media (max-width: 768px) {
  .modern-dialog {
    max-width: 340px;
    margin: 10px;
    border-radius: 20px;
  }

  .dialog-header {
    padding: 1.5rem 1.5rem 1rem;
  }

  .dialog-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    margin-bottom: 0.75rem;
  }

  .dialog-title-text {
    font-size: 1.1rem;
  }

  .dialog-body {
    padding: 1.5rem;
  }

  .dialog-description {
    font-size: 0.9rem;
    margin-bottom: 1.25rem;
  }

  .command-container {
    margin-bottom: 1.25rem;
  }

  .command-box {
    padding: 0.875rem 1rem;
    border-radius: 12px;
  }

  .command-box code {
    font-size: 0.9rem;
    padding: 4px 8px;
  }

  .info-box {
    padding: 0.625rem 0.875rem;
    font-size: 0.85rem;
    border-radius: 10px;
  }

  .dialog-footer {
    padding: 1.25rem 1.5rem;
  }

  .modern-dialog-btn {
    padding: 10px 24px;
    font-size: 0.9rem;
    border-radius: 10px;
  }
}

@media (max-width: 480px) {
  .modern-dialog {
    max-width: 300px;
    margin: 8px;
    border-radius: 16px;
  }

  .dialog-header {
    padding: 1.25rem 1.25rem 0.875rem;
  }

  .dialog-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    margin-bottom: 0.5rem;
  }

  .dialog-title-text {
    font-size: 1rem;
  }

  .dialog-body {
    padding: 1.25rem;
  }

  .dialog-description {
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .command-container {
    margin-bottom: 1rem;
  }

  .command-label {
    font-size: 0.8rem;
    margin-bottom: 0.375rem;
  }

  .command-box {
    padding: 0.75rem 0.875rem;
    border-radius: 10px;
  }

  .command-box code {
    font-size: 0.85rem;
    padding: 3px 6px;
  }

  .info-box {
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    border-radius: 8px;
  }

  .dialog-footer {
    padding: 1rem 1.25rem;
  }

  .modern-dialog-btn {
    padding: 8px 20px;
    font-size: 0.85rem;
    border-radius: 8px;
  }
}

/* 底部信息 */
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

/* 通知样式 */
.modern-snackbar :deep(.v-snackbar__wrapper) {
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.modern-snackbar :deep(.v-snackbar__content) {
  border-radius: 16px;
  padding: 12px 16px;
}

.snackbar-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.snackbar-icon {
  font-size: 1.2rem;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .modern-auth-container {
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

  .login-btn, .oauth-btn {
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

  .modern-input :deep(.v-field__input) {
    padding: 10px 16px;
    font-size: 0.95rem;
  }
}

@media (max-height: 700px) {
  .modern-auth-container {
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
  .modern-auth-container {
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
</style>