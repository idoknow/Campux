<template>
  <div class="admin-page-container">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="brand-section">
        <h1 class="brand-title">Campux</h1>
        <span class="brand-subtitle">{{ $store.state.metadata.brand }}</span>
      </div>
    </div>

    <!-- 现代化标签页 -->
    <div class="modern-tabs-container">
      <div class="tabs-wrapper">
        <div class="tab-item"
             :class="{ 'tab-active': tab === '1' }"
             @click="tab = '1'">
          <v-icon class="tab-icon" :color="tab === '1' ? '#3b82f6' : '#6b7280'" size="18">mdi-account-group</v-icon>
          <span class="tab-label">账号管理</span>
        </div>
        <div class="tab-item"
             :class="{ 'tab-active': tab === '2' }"
             @click="tab = '2'">
          <v-icon class="tab-icon" :color="tab === '2' ? '#3b82f6' : '#6b7280'" size="18">mdi-gavel</v-icon>
          <span class="tab-label">封禁记录</span>
        </div>
        <div class="tab-item"
             :class="{ 'tab-active': tab === '3' }"
             @click="tab = '3'"
             v-if="$store.state.account.userGroup === 'admin' || $store.state.account.userGroup === 'member'">
          <v-icon class="tab-icon" :color="tab === '3' ? '#3b82f6' : '#6b7280'" size="18">mdi-database-cog</v-icon>
          <span class="tab-label">元数据</span>
        </div>
        <div class="tab-item"
             :class="{ 'tab-active': tab === '4' }"
             @click="tab = '4'"
             v-if="$store.state.account.userGroup === 'admin'">
          <v-icon class="tab-icon" :color="tab === '4' ? '#3b82f6' : '#6b7280'" size="18">mdi-key-variant</v-icon>
          <span class="tab-label">OAuth应用</span>
        </div>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 账号管理 -->
      <div v-if="tab === '1'" class="content-section">
        <div class="section-header">
          <div class="header-info">
            <v-icon color="#3b82f6" size="20">mdi-account-group</v-icon>
            <h2 class="section-title">账号管理</h2>
          </div>
        </div>

        <!-- 搜索和筛选 -->
        <div class="filter-section">
          <div class="filter-row">
            <v-text-field
              v-model="filter.uin"
              label="输入UIN搜索"
              variant="outlined"
              class="search-input"
              prepend-inner-icon="mdi-magnify">
            </v-text-field>
            <v-select
              v-model="filter.user_group"
              label="用户组筛选"
              :items="[
                { title: '全部', value: 'any' },
                { title: '普通用户', value: 'user' },
                { title: '成员', value: 'member' },
                { title: '管理员', value: 'admin' }
              ]"
              variant="outlined"
              class="group-select">
            </v-select>
            <v-btn
              @click="getAccounts"
              class="search-btn"
              :loading="accountRefreshing"
              size="large">
              <v-icon left>mdi-magnify</v-icon>
              查找
            </v-btn>
          </div>
        </div>

        <!-- 分页 -->
        <div class="pagination-container" v-if="accountPages > 1">
          <v-pagination
            :length="accountPages"
            v-model="filter.page"
            class="modern-pagination"
            @update:model-value="getAccounts">
          </v-pagination>
        </div>

        <!-- 账号列表 -->
        <div class="accounts-container">
          <div v-if="accounts.length === 0" class="empty-state">
            <v-icon color="#94a3b8" size="48">mdi-account-search</v-icon>
            <h3 class="empty-title">未找到账号</h3>
            <p class="empty-desc">请尝试调整搜索条件</p>
          </div>
          <div v-else class="list-scrollable">
            <div class="accounts-list">
              <AccountCard v-for="a in accounts"
                           :key="a.id"
                           :account="a"
                           class="account-card"
                           @changeGroup="changeGroup"
                           @banAccount="banAccount"
                           @toast="toast" />
            </div>
          </div>
        </div>
      </div>
      <!-- 封禁记录 -->
      <div v-if="tab === '2'" class="content-section">
        <div class="section-header">
          <div class="header-info">
            <v-icon color="#ef4444" size="20">mdi-gavel</v-icon>
            <h2 class="section-title">封禁记录</h2>
          </div>
        </div>

        <!-- 搜索和筛选 -->
        <div class="filter-section">
          <div class="filter-row">
            <v-text-field
              v-model="filter.uin"
              label="输入UIN搜索"
              variant="outlined"
              class="search-input"
              prepend-inner-icon="mdi-magnify">
            </v-text-field>
            <div class="filter-checkbox">
              <v-checkbox
                v-model="banListFilter.only_valid"
                label="仅生效中的"
                @change="getBanList">
              </v-checkbox>
            </div>
            <v-btn
              @click="getBanList"
              class="search-btn"
              :loading="banlistRefreshing"
              size="large">
              <v-icon left>mdi-magnify</v-icon>
              查找
            </v-btn>
          </div>
        </div>

        <!-- 分页 -->
        <div class="pagination-container" v-if="banPages > 1">
          <v-pagination
            :length="banPages"
            v-model="banListFilter.page"
            class="modern-pagination"
            @update:model-value="getBanList">
          </v-pagination>
        </div>

        <!-- 封禁记录列表 -->
        <div class="ban-records-container">
          <div v-if="banRecords.length === 0" class="empty-state">
            <v-icon color="#94a3b8" size="48">mdi-gavel</v-icon>
            <h3 class="empty-title">未找到封禁记录</h3>
            <p class="empty-desc">请尝试调整搜索条件</p>
          </div>
          <div v-else class="list-scrollable">
            <div class="ban-records-list">
              <BanRecordCard v-for="b in banRecords"
                             :key="b.id"
                             :banRecord="b"
                             class="ban-record-card"
                             @unban="unban"
                             @toast="toast" />
            </div>
          </div>
        </div>
      </div>
      <!-- 元数据管理 -->
      <div v-if="tab === '3'" class="content-section">
        <div class="section-header">
          <div class="header-info">
            <v-icon color="#8b5cf6" size="20">mdi-database-cog</v-icon>
            <h2 class="section-title">元数据管理</h2>
          </div>
          <div class="header-actions">
            <v-btn
              @click="getMetadataList"
              :loading="metadataListRefreshing"
              class="action-btn"
              variant="outlined">
              <v-icon left>mdi-refresh</v-icon>
              刷新
            </v-btn>
            <v-btn
              @click="saveMetadata"
              :loading="metadataListRefreshing"
              class="save-btn">
              <v-icon left>mdi-content-save</v-icon>
              保存所有
            </v-btn>
          </div>
        </div>

        <!-- 元数据列表 -->
        <div class="metadata-container">
          <div v-if="metadataList.length === 0" class="empty-state">
            <v-icon color="#94a3b8" size="48">mdi-database-off</v-icon>
            <h3 class="empty-title">暂无元数据</h3>
            <p class="empty-desc">点击刷新按钮加载元数据</p>
          </div>
          <div v-else class="metadata-scrollable">
            <div class="metadata-list">
              <div v-for="m in metadataList" :key="m.key" class="metadata-item">
                <v-text-field
                  v-model="m.value"
                  :label="m.key"
                  variant="outlined"
                  class="metadata-input">
                </v-text-field>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- OAuth应用管理 -->
      <div v-if="tab === '4'" class="content-section">
        <div class="section-header">
          <div class="header-info">
            <v-icon color="#f59e0b" size="20">mdi-key-variant</v-icon>
            <h2 class="section-title">OAuth应用管理</h2>
          </div>
          <div class="header-actions">
            <v-btn
              @click="showOAuthAppCreateDialog = true"
              class="create-btn">
              <v-icon left>mdi-plus</v-icon>
              新建应用
            </v-btn>
            <v-btn
              @click="getOAuthApps"
              :loading="oauthRefreshing"
              class="action-btn"
              variant="outlined">
              <v-icon left>mdi-refresh</v-icon>
              刷新
            </v-btn>
          </div>
        </div>

        <!-- OAuth应用列表 -->
        <div class="oauth-apps-container">
          <div v-if="oauthApps.length === 0" class="empty-state">
            <v-icon color="#94a3b8" size="48">mdi-key-off</v-icon>
            <h3 class="empty-title">暂无OAuth应用</h3>
            <p class="empty-desc">点击新建应用按钮创建第一个应用</p>
          </div>
          <div v-else class="list-scrollable">
            <div class="oauth-apps-list">
              <OAuthAppCard v-for="o in oauthApps"
                            :key="o.name"
                            :oauthApp="o"
                            class="oauth-app-card"
                            @toast="toast"
                            @deleteApp="deleteOAuthApp" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 通知栏 -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout"
                class="modern-snackbar" style="margin-bottom: 64px">
      {{ snackbar.text }}
    </v-snackbar>

    <!-- 服务提示对话框 -->
    <v-dialog v-model="showServiceHint" max-width="400">
      <div class="modern-dialog" v-if="selectedService >= 0">
        <div class="dialog-header">
          <v-icon color="#3b82f6" size="24">mdi-information</v-icon>
          <h3 class="dialog-title">提示</h3>
        </div>
        <div class="dialog-content">
          <p class="dialog-message">{{ services[selectedService]?.toast || '确认执行此操作？' }}</p>
        </div>
        <div class="dialog-actions">
          <v-btn class="dialog-btn cancel-btn" @click="showServiceHint = false">取消</v-btn>
          <v-btn class="dialog-btn confirm-btn" @click="showServiceHint = false; go(services[selectedService].link)">确定</v-btn>
        </div>
      </div>
    </v-dialog>

    <!-- OAuth应用创建对话框 -->
    <v-dialog v-model="showOAuthAppCreateDialog" max-width="500">
      <div class="modern-dialog">
        <div class="dialog-header">
          <v-icon color="#f59e0b" size="24">mdi-plus-circle</v-icon>
          <h3 class="dialog-title">新建 OAuth2 应用</h3>
        </div>
        <div class="dialog-content">
          <v-text-field
            v-model="newOAuthApp.name"
            label="应用名称"
            variant="outlined"
            class="modern-input">
          </v-text-field>
          <div id="emoji-picking">
            <p id="oauth-emoji">{{ newOAuthApp.emoji }}</p>
            <EmojiPicker id="oauth-emoji-picker" :native="true" @select="onEmojiSelect" />
          </div>
        </div>
        <div class="dialog-actions">
          <v-btn class="dialog-btn cancel-btn" @click="showOAuthAppCreateDialog = false">取消</v-btn>
          <v-btn class="dialog-btn confirm-btn" @click="createOAuthApp">确定</v-btn>
        </div>
      </div>
    </v-dialog>
  </div>
</template>

<script>
import AccountCard from '@/components/AccountCard.vue';
import BanRecordCard from '@/components/BanRecordCard.vue';
import OAuthAppCard from '@/components/OAuthAppCard.vue';

import EmojiPicker from 'vue3-emoji-picker'
import 'vue3-emoji-picker/css'

export default {
    name: 'AdminPage',
    components: {
        AccountCard,
        BanRecordCard,
        OAuthAppCard,
        EmojiPicker
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
            tab: '1',
            accounts: [],
            accountRefreshing: false,
            filter: {
                uin: '',
                user_group: 'any',
                time_order: 1,
                page: 1,
                page_size: 10
            },
            accountPages: 1,
            banListFilter: {
                uin: -1,
                only_valid: true,
                page: 1,
                page_size: 10,
                time_order: -1
            },
            banlistRefreshing: false,
            banRecords: [],
            banPages: 1,
            oauthApps: [],
            oauthRefreshing: false,
            showOAuthAppCreateDialog: false,
            newOAuthApp: {
                name: '',
                emoji: '🥰',
            },
            metadataList: [],
            metadataListRefreshing: false,
            saveMetadataLoading: false,
        }
    },

    watch: {
        tab() {
            if (this.tab === '1') {
                this.getAccounts()
            } else if (this.tab === '2') {
                this.getBanList()
            } else if (this.tab === '4') {
                this.getOAuthApps()
            } else if (this.tab === '3') {
                this.getMetadataList()
            }
        }
    },

    mounted() {
    },

    methods: {

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

        getAccounts() {
            if (this.filter.uin === '') {
                this.filter.uin = -1
            } else {
                this.filter.uin = parseInt(this.filter.uin)
            }

            this.accountRefreshing = true

            this.$axios.post('/v1/account/get-accounts', this.filter)
                .then(res => {
                    if (res.data.code === 0) {
                        this.accounts = res.data.data.list

                        for (let i = 0; this.accounts != null && i < this.accounts.length; i++) {
                            let date = new Date(this.accounts[i].created_at)

                            this.accounts[i].created_at = date.toLocaleString()
                        }
                        this.accountPages = Math.ceil(res.data.data.total / this.filter.page_size)
                    } else {
                        this.toast('获取账号失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取账号失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.accountRefreshing = false
                })
        },

        changeGroup(account, newGroup) {
            this.$axios.put('/v1/account/change-group', {
                uin: account.uin,
                new_group: newGroup
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('修改成功', 'success')
                        account.user_group = newGroup
                    } else {
                        this.toast('修改失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('修改失败：' + err)
                    console.error(err)
                })
        },


        banAccount(account, reason, date) {
            this.$axios.post('/v1/account/ban-account', {
                uin: account.uin,
                comment: reason,
                end_time: date.getTime() / 1000
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('封禁成功', 'success')
                    } else {
                        this.toast('封禁失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('封禁失败：' + err)
                    console.error(err)
                })
        },


        getBanList() {

            if (this.banListFilter.uin === '') {
                this.banListFilter.uin = -1
            } else {
                this.banListFilter.uin = parseInt(this.banListFilter.uin)
            }
            this.banlistRefreshing = true
            this.$axios.post('/v1/account/get-ban-list', this.banListFilter)
                .then(res => {
                    if (res.data.code === 0) {
                        this.banRecords = res.data.data.list

                        let now = new Date()

                        for (let i = 0; this.banRecords != null && i < this.banRecords.length; i++) {
                            let startDateTime = new Date(this.banRecords[i].start_time)
                            let endDateTime = new Date(this.banRecords[i].end_time)

                            this.banRecords[i].start_time = startDateTime.toLocaleString()
                            this.banRecords[i].end_time = endDateTime.toLocaleString()
                            this.banRecords[i].valid = endDateTime > now
                        }

                        this.banPages = Math.ceil(res.data.data.total / this.banListFilter.page_size)
                    } else {
                        this.toast('获取封禁列表失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取封禁列表失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.banlistRefreshing = false
                })
        },

        unban(uin) {
            this.$axios.put('/v1/account/unban-account', {
                uin: uin
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('解封成功', 'success')
                        this.getBanList()
                    } else {
                        this.toast('解封失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('解封失败：' + err)
                    console.error(err)
                })
        },

        getOAuthApps() {
            this.oauthRefreshing = true

            this.$axios.get('/v1/admin/get-oauth2-apps')
                .then(res => {
                    if (res.data.code === 0) {
                        this.oauthApps = res.data.data.list
                        console.log(this.oauthApps)
                    } else {
                        this.toast('获取OAuth应用失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取OAuth应用失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.oauthRefreshing = false
                })
        },
        onEmojiSelect(emoji) {
            this.newOAuthApp.emoji = emoji.i
        },
        createOAuthApp() {

            if (this.newOAuthApp.name === '') {
                this.toast('应用名称不能为空')
                return
            }

            this.$axios.post('/v1/admin/add-oauth2-app', this.newOAuthApp)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('创建成功', 'success')
                        this.getOAuthApps()
                        this.showOAuthAppCreateDialog = false
                        this.newOAuthApp.name = ''
                        this.newOAuthApp.emoji = '🥰'
                    } else {
                        this.toast('创建失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('创建失败：' + err)
                    console.error(err)
                })
        },
        deleteOAuthApp(appID) {
            this.$axios.delete('/v1/admin/del-oauth2-app/'+appID)
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('删除成功', 'success')
                        this.getOAuthApps()
                    } else {
                        this.toast('删除失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('删除失败：' + err)
                    console.error(err)
                })
        },
        getMetadataList() {
            this.metadataListRefreshing = true
            this.$axios.get('/v1/misc/get-metadata-list')
                .then(res => {
                    if (res.data.code === 0) {
                        this.metadataList = res.data.data.list
                    } else {
                        this.toast('获取元数据失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('获取元数据失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.metadataListRefreshing = false
                })
        },
        saveMetadata() {
            this.saveMetadataLoading = true
            this.$axios.put('/v1/misc/save-metadatas', {
                list: this.metadataList
            })
                .then(res => {
                    if (res.data.code === 0) {
                        this.toast('保存成功', 'success')
                    } else {
                        this.toast('保存失败：' + res.data.msg)
                    }
                })
                .catch(err => {
                    this.toast('保存失败：' + err)
                    console.error(err)
                })
                .finally(() => {
                    this.saveMetadataLoading = false
                })
        }
    }
}

</script>

<style scoped>
/* 管理页面整体布局 */
.admin-page-container {
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

/* 现代化标签页 */
.modern-tabs-container {
  background: white;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 20px;
  position: sticky;
  top: 72px;
  z-index: 9;
}

.tabs-wrapper {
  display: flex;
  max-width: 800px;
  margin: 0 auto;
  gap: 8px;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s ease;
  position: relative;
}

.tab-item:hover {
  background: rgba(59, 130, 246, 0.05);
}

.tab-active {
  border-bottom-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.tab-icon {
  flex-shrink: 0;
}

.tab-label {
  font-weight: 500;
  color: #374151;
  font-size: 14px;
}

.tab-active .tab-label {
  color: #3b82f6;
  font-weight: 600;
}

/* 主要内容区域 */
.main-content {
  flex: 1;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
  padding: 20px;
}

.content-section {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

/* 区域头部 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #f1f5f9;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  border-color: #e2e8f0 !important;
  color: #64748b !important;
}

.save-btn {
  background: #10b981 !important;
  color: white !important;
}

.create-btn {
  background: #3b82f6 !important;
  color: white !important;
}

/* 筛选区域 */
.filter-section {
  padding: 20px;
  border-bottom: 1px solid #f1f5f9;
}

.filter-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
}

.search-input {
  flex: 1;
  max-width: 300px;
}

.group-select {
  min-width: 150px;
}

.filter-checkbox {
  display: flex;
  align-items: center;
  padding-top: 8px;
}

.search-btn {
  background: #3b82f6 !important;
  color: white !important;
  border-radius: 12px !important;
}

/* 统一按钮圆角样式 */
.action-btn,
.save-btn,
.create-btn,
.search-btn,
.dialog-btn {
  border-radius: 12px !important;
  font-weight: 500 !important;
  text-transform: none !important;
}

#container-wrap {
    min-height: 74vh;
}

/* 分页容器 */
.pagination-container {
  padding: 16px 20px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: center;
}

.modern-pagination {
  margin: 0;
}

.modern-pagination :deep(.v-pagination__item) {
  border-radius: 8px !important;
  margin: 0 2px !important;
}

.modern-pagination :deep(.v-pagination__prev),
.modern-pagination :deep(.v-pagination__next) {
  border-radius: 8px !important;
}

/* 列表容器 */
.accounts-container,
.ban-records-container,
.oauth-apps-container {
  padding: 20px;
}

.metadata-container {
  padding: 20px 20px 12px 20px;
}

.accounts-list,
.ban-records-list,
.oauth-apps-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.account-card,
.ban-record-card,
.oauth-app-card {
  border-radius: 12px;
  overflow: hidden;
}

/* 通用列表滚动容器 */
.list-scrollable,
.metadata-scrollable {
  max-height: calc(100vh - 400px);
  overflow-y: auto;
  padding: 8px 8px 8px 0;
}

.list-scrollable::-webkit-scrollbar,
.metadata-scrollable::-webkit-scrollbar {
  width: 6px;
}

.list-scrollable::-webkit-scrollbar-track,
.metadata-scrollable::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 3px;
}

.list-scrollable::-webkit-scrollbar-thumb,
.metadata-scrollable::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.list-scrollable::-webkit-scrollbar-thumb:hover,
.metadata-scrollable::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.metadata-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 元数据项 */
.metadata-item {
  margin-bottom: 0;
}

.metadata-input {
  background: #f8fafc;
}

/* 统一输入框圆角样式 */
.search-input :deep(.v-field__outline),
.metadata-input :deep(.v-field__outline),
.modern-input :deep(.v-field__outline) {
  border-radius: 16px !important;
}

.search-input :deep(.v-field__outline__start),
.metadata-input :deep(.v-field__outline__start),
.modern-input :deep(.v-field__outline__start) {
  border-radius: 16px 0 0 16px !important;
  border-right: none !important;
}

.search-input :deep(.v-field__outline__end),
.metadata-input :deep(.v-field__outline__end),
.modern-input :deep(.v-field__outline__end) {
  border-radius: 0 16px 16px 0 !important;
  border-left: none !important;
}

.search-input :deep(.v-field__input),
.metadata-input :deep(.v-field__input),
.modern-input :deep(.v-field__input) {
  border-radius: 16px !important;
}

/* 选择框圆角样式 */
.group-select :deep(.v-field__outline) {
  border-radius: 16px !important;
}

.group-select :deep(.v-field__outline__start) {
  border-radius: 16px 0 0 16px !important;
  border-right: none !important;
}

.group-select :deep(.v-field__outline__end) {
  border-radius: 0 16px 16px 0 !important;
  border-left: none !important;
}

.group-select :deep(.v-field__input) {
  border-radius: 16px !important;
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

#emoji-picking {
    display: flex;
    flex-direction: row;
}

#oauth-emoji {
    font-size: 48px;
    text-align: center;
    margin-right: 1rem;
}

#oauth-emoji-picker {
    width: 15rem;
    height: 17rem;
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

  .modern-tabs-container {
    padding: 0 16px;
    top: 60px;
  }

  .tabs-wrapper {
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .tabs-wrapper::-webkit-scrollbar {
    display: none;
  }

  .tab-item {
    padding: 12px 16px;
    gap: 6px;
    white-space: nowrap;
  }

  .tab-label {
    font-size: 13px;
  }

  .main-content {
    padding: 16px;
  }

  .section-header {
    padding: 16px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .section-title {
    font-size: 16px;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .filter-section {
    padding: 16px;
  }

  .filter-row {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .search-input {
    max-width: none;
  }

  .group-select {
    min-width: auto;
  }

  .accounts-container,
  .ban-records-container,
  .metadata-container,
  .oauth-apps-container {
    padding: 16px;
  }

  .list-scrollable,
  .metadata-scrollable {
    max-height: calc(100vh - 350px);
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
}

@media (max-width: 480px) {
  .page-header {
    padding: 10px 12px;
  }

  .brand-title {
    font-size: 22px;
  }

  .modern-tabs-container {
    padding: 0 12px;
    top: 52px;
  }

  .tab-item {
    padding: 10px 12px;
    gap: 4px;
  }

  .tab-label {
    font-size: 12px;
  }

  .main-content {
    padding: 12px;
  }

  .section-header {
    padding: 14px;
  }

  .filter-section {
    padding: 14px;
  }

  .accounts-container,
  .ban-records-container,
  .metadata-container,
  .oauth-apps-container {
    padding: 14px;
  }

  .list-scrollable,
  .metadata-scrollable {
    max-height: calc(100vh - 320px);
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