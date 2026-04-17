<template>
  <div class="modern-account-card">
    <!-- 卡片头部 -->
    <div class="card-header">
      <div class="user-info">
        <div class="avatar-container">
          <v-avatar
            :size="avatarSize"
            :image="avatarBaseUrl + account.uin + '&s=100'"
            class="user-avatar">
          </v-avatar>
          <div class="status-indicator" :class="getStatusClass()"></div>
        </div>
        <div class="user-details">
          <h3 class="user-uin">{{ account.uin }}</h3>
          <div class="user-meta">
            <v-chip
              class="group-chip"
              :class="getGroupChipClass()"
              size="small"
              @click="showGroupDialog()">
              <v-icon left size="14">{{ getGroupIcon() }}</v-icon>
              {{ userGroup[account.user_group] }}
            </v-chip>
            <span class="created-date">
              <v-icon size="12">mdi-calendar</v-icon>
              {{ formatDate(account.created_at) }}
            </span>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <v-btn
          class="action-btn ban-btn"
          @click="showBanningDialog()"
          size="small"
          variant="outlined">
          <v-icon left size="16">mdi-gavel</v-icon>
          封禁
        </v-btn>
      </div>
    </div>
  </div>

  <!-- 修改用户组对话框 -->
  <v-dialog v-model="groupDialog" max-width="400">
    <div class="modern-dialog">
      <div class="dialog-header">
        <v-icon color="#3b82f6" size="24">mdi-account-cog</v-icon>
        <h3 class="dialog-title">修改用户组</h3>
      </div>
      <div class="dialog-content">
        <v-select
          v-model="newGroup"
          :items="userGroupOptions"
          label="用户组"
          variant="outlined"
          class="group-select">
        </v-select>
      </div>
      <div class="dialog-actions">
        <v-btn class="dialog-btn cancel-btn" @click="groupDialog = false">取消</v-btn>
        <v-btn class="dialog-btn confirm-btn" @click="groupDialog = false; emitChangeGroup()">确认</v-btn>
      </div>
    </div>
  </v-dialog>

  <!-- 封禁用户对话框 -->
  <v-dialog v-model="dialog" max-width="500">
    <div class="modern-dialog">
      <div class="dialog-header">
        <v-icon color="#ef4444" size="24">mdi-gavel</v-icon>
        <h3 class="dialog-title">封禁用户</h3>
      </div>
      <div class="dialog-content">
        <div class="ban-user-info">
          <v-avatar
            :size="40"
            :image="avatarBaseUrl + account.uin + '&s=100'"
            class="ban-avatar">
          </v-avatar>
          <div class="ban-details">
            <h4 class="ban-uin">{{ account.uin }}</h4>
            <span class="ban-group">{{ userGroup[account.user_group] }}</span>
          </div>
        </div>
        <v-text-field
          v-model="reason"
          label="封禁原因"
          variant="outlined"
          class="ban-reason-input"
          placeholder="请输入封禁原因...">
        </v-text-field>
        <div class="date-picker-section">
          <label class="date-label">封禁结束时间</label>
          <v-date-picker
            v-model="date"
            show-adjacent-months
            class="ban-date-picker">
          </v-date-picker>
        </div>
      </div>
      <div class="dialog-actions">
        <v-btn class="dialog-btn cancel-btn" @click="dialog = false">取消</v-btn>
        <v-btn class="dialog-btn danger-btn" @click="emitBanAccount()">确认封禁</v-btn>
      </div>
    </div>
  </v-dialog>
</template>

<script>
export default {
  name: 'AccountCard',
  props: ['account'],
  data() {
    return {
      dialog: false,
      groupDialog: false,
      reason: "",
      userGroup: {
        'user': '普通用户',
        'member': '成员',
        'admin': '管理员',
      },
      userGroups: [
        'user',
        'member',
        'admin',
      ],
      userGroupOptions: [
        { title: '普通用户', value: 'user' },
        { title: '成员', value: 'member' },
        { title: '管理员', value: 'admin' },
      ],
      userGroupColor: {
        'user': '#fff',
        'member': '#66BB6A',
        'admin': '#ee7023',
      },
      backgrouldColor: "",
      avatarBaseUrl: "http://q1.qlogo.cn/g?b=qq&nk=",
      newGroup: "",
      date: null,
      windowWidth: 0,
    }
  },
  mounted() {
    this.backgrouldColor = '#42A5F5'
    this.newGroup = this.account.user_group
    this.updateWindowWidth()
    window.addEventListener('resize', this.updateWindowWidth)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.updateWindowWidth)
  },
  computed: {
    avatarSize() {
      return this.windowWidth <= 480 ? 50 : 56
    }
  },
  methods: {
    showGroupDialog() {
      this.groupDialog = true
    },
    showBanningDialog() {
      this.dialog = true
    },
    emitChangeGroup() {
      this.$emit('changeGroup', this.account, this.newGroup)
    },
    emitBanAccount() {
      if (this.reason === "") {
        this.toast('请填写封禁原因')
        return
      }

      if (this.date === null) {
        this.toast('请选择封禁结束时间')
        return
      } else if (this.date < new Date()) {
        this.toast('封禁结束时间不能早于当前时间')
        return
      }

      this.$emit('banAccount', this.account, this.reason, this.date)
      this.dialog = false
    },

    toast(msg, color = 'error') {
      this.$emit('toast', msg, color)
    },
    getGroupIcon() {
      const iconMap = {
        'user': 'mdi-account',
        'member': 'mdi-account-star',
        'admin': 'mdi-shield-account'
      }
      return iconMap[this.account.user_group] || 'mdi-account'
    },
    getGroupChipClass() {
      return `group-chip-${this.account.user_group}`
    },
    getStatusClass() {
      // 可以根据用户状态返回不同的类名
      return 'status-online'
    },
    formatDate(dateString) {
      const date = new Date(dateString)
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    },
    updateWindowWidth() {
      if (typeof window !== 'undefined') {
        this.windowWidth = window.innerWidth
      }
    }
  },
}
</script>

<style scoped>
/* 现代化账号卡片 */
.modern-account-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  border: 1px solid #f1f5f9;
  transition: all 0.2s ease;
  overflow: hidden;
}

.modern-account-card:hover {
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.12);
  transform: translateY(-2px);
}

/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

/* 头像容器 */
.avatar-container {
  position: relative;
}

.user-avatar {
  border: 3px solid #f8fafc;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.user-avatar :deep(.v-avatar__image) {
  object-fit: cover;
  width: 100%;
  height: 100%;
}

.status-indicator {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid white;
}

.status-online {
  background: #10b981;
}

/* 用户详情 */
.user-details {
  flex: 1;
}

.user-uin {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.user-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* 用户组标签 */
.group-chip {
  font-weight: 500 !important;
  border-radius: 8px !important;
  cursor: pointer !important;
  transition: all 0.2s ease !important;
}

.group-chip:hover {
  transform: scale(1.05) !important;
}

.group-chip-user {
  background: linear-gradient(135deg, #64748b, #475569) !important;
  color: white !important;
}

.group-chip-member {
  background: linear-gradient(135deg, #10b981, #059669) !important;
  color: white !important;
}

.group-chip-admin {
  background: linear-gradient(135deg, #f59e0b, #d97706) !important;
  color: white !important;
}

/* 创建日期 */
.created-date {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
}

/* 操作按钮 */
.card-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  border-radius: 8px !important;
  font-weight: 500 !important;
  text-transform: none !important;
}

.ban-btn {
  border-color: #ef4444 !important;
  color: #ef4444 !important;
}

.ban-btn:hover {
  background: #ef4444 !important;
  color: white !important;
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

/* 封禁对话框特殊样式 */
.ban-user-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fef2f2;
  border-radius: 12px;
  margin-bottom: 20px;
}

.ban-avatar {
  border: 2px solid #fecaca;
}

.ban-avatar :deep(.v-avatar__image) {
  object-fit: cover;
  width: 100%;
  height: 100%;
}

.ban-details {
  flex: 1;
}

.ban-uin {
  font-size: 16px;
  font-weight: 600;
  color: #dc2626;
  margin: 0 0 4px 0;
}

.ban-group {
  color: #7f1d1d;
  font-size: 13px;
  font-weight: 500;
}

.ban-reason-input {
  margin-bottom: 20px;
}

.date-picker-section {
  margin-top: 16px;
}

.date-label {
  display: block;
  font-weight: 500;
  color: #374151;
  margin-bottom: 8px;
  font-size: 14px;
}

.ban-date-picker {
  border-radius: 12px;
  overflow: hidden;
}

/* 选择框圆角 */
.group-select :deep(.v-field__outline) {
  border-radius: 12px !important;
}

.group-select :deep(.v-field__outline__start) {
  border-radius: 12px 0 0 12px !important;
  border-right: none !important;
}

.group-select :deep(.v-field__outline__end) {
  border-radius: 0 12px 12px 0 !important;
  border-left: none !important;
}

.ban-reason-input :deep(.v-field__outline) {
  border-radius: 12px !important;
}

.ban-reason-input :deep(.v-field__outline__start) {
  border-radius: 12px 0 0 12px !important;
  border-right: none !important;
}

.ban-reason-input :deep(.v-field__outline__end) {
  border-radius: 0 12px 12px 0 !important;
  border-left: none !important;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .card-header {
    padding: 16px;
  }

  .user-info {
    gap: 12px;
  }

  .user-uin {
    font-size: 16px;
  }

  .user-meta {
    gap: 8px;
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

  .ban-user-info {
    padding: 12px;
  }
}

/* 移动端头像尺寸通过JavaScript动态控制 */
</style>