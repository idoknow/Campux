<template>
  <div class="world-page-container">
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
          <v-icon class="tab-icon" :color="tab === '1' ? '#3b82f6' : '#6b7280'" size="18">mdi-file-document</v-icon>
          <span class="tab-label">你的稿件</span>
        </div>
        <div class="tab-item"
             :class="{ 'tab-active': tab === '2' }"
             @click="tab = '2'">
          <v-icon class="tab-icon" :color="tab === '2' ? '#3b82f6' : '#6b7280'" size="18">mdi-earth</v-icon>
          <span class="tab-label">动态</span>
        </div>
        <div class="tab-item"
             :class="{ 'tab-active': tab === '3' }"
             @click="tab = '3'"
             v-if="$store.state.account.userGroup === 'admin' || $store.state.account.userGroup === 'member'">
          <v-icon class="tab-icon" :color="tab === '3' ? '#3b82f6' : '#6b7280'" size="18">mdi-gavel</v-icon>
          <span class="tab-label">审核稿件</span>
        </div>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 你的稿件 -->
      <div v-if="tab === '1'" class="content-section">
        <div class="section-header">
          <div class="header-info">
            <v-icon color="#3b82f6" size="20">mdi-file-document</v-icon>
            <h2 class="section-title">你的稿件</h2>
          </div>
          <div class="header-actions">
            <v-btn
              class="action-btn"
              @click="refreshPosts"
              :loading="pullLoading"
              variant="outlined"
              size="small">
              <v-icon size="16">mdi-refresh</v-icon>
              刷新
            </v-btn>
          </div>
        </div>

        <div class="posts-container">
          <div v-if="posts.length === 0" class="empty-state">
            <v-icon color="#94a3b8" size="48">mdi-file-document-outline</v-icon>
            <h3 class="empty-title">还没有稿件</h3>
            <p class="empty-desc">快去投稿页面发布你的第一篇稿件吧！</p>
          </div>
          <div v-else class="posts-list">
            <PostCard v-for="p in posts" :key="p.id" :post="p" typ="self" class="post-card" @recall="recallPost" />
          </div>
        </div>
      </div>

      <!-- 动态 -->
      <div v-if="tab === '2'" class="content-section">
        <div class="coming-soon">
          <div class="coming-soon-content">
            <v-icon color="#f59e0b" size="64">mdi-rocket-launch</v-icon>
            <h2 class="coming-soon-title">即将上线</h2>
            <p class="coming-soon-desc">动态功能正在开发中，敬请期待！</p>
            <div class="coming-soon-features">
              <div class="feature-item">
                <v-icon color="#10b981" size="16">mdi-check</v-icon>
                <span>实时动态推送</span>
              </div>
              <div class="feature-item">
                <v-icon color="#10b981" size="16">mdi-check</v-icon>
                <span>互动评论系统</span>
              </div>
              <div class="feature-item">
                <v-icon color="#10b981" size="16">mdi-check</v-icon>
                <span>个性化推荐</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 审核稿件 -->
      <div v-if="tab === '3'" class="content-section">
        <div class="section-header">
          <div class="header-info">
            <v-icon color="#f59e0b" size="20">mdi-gavel</v-icon>
            <h2 class="section-title">审核稿件</h2>
          </div>
          <div class="header-actions">
            <v-btn
              class="action-btn"
              @click="getJudgePosts"
              :loading="pullLoading"
              variant="outlined"
              size="small">
              <v-icon size="16">mdi-refresh</v-icon>
              刷新
            </v-btn>
          </div>
        </div>

        <div class="pagination-container" v-if="judgePages > 1">
          <v-pagination
            :length="judgePages"
            v-model="judgeCurrentPage"
            @update:model-value="getJudgePosts"
            class="modern-pagination">
          </v-pagination>
        </div>

        <div class="posts-container">
          <div v-if="judgePosts.length === 0" class="empty-state">
            <v-icon color="#94a3b8" size="48">mdi-gavel</v-icon>
            <h3 class="empty-title">暂无待审核稿件</h3>
            <p class="empty-desc">所有稿件都已处理完毕</p>
          </div>
          <div v-else class="posts-list">
            <PostCard v-for="p in judgePosts" :key="p.id" :post="p" typ="judge" class="post-card"
              currentFilterStatus="{{ filterForJudge.status }}" @updateJudgePost="updateJudgePost" />
          </div>
        </div>
      </div>
    </div>

    <!-- 通知栏 -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout"
                class="modern-snackbar" style="margin-bottom: 64px">
      {{ snackbar.text }}
    </v-snackbar>

    <!-- 筛选菜单 -->
    <v-menu v-if="tab === '1'" location="top" offset="8">
      <template v-slot:activator="{ props }">
        <div class="floating-filter-btn">
          <v-btn v-bind="props"
                 class="filter-btn"
                 :loading="pullLoading"
                 variant="elevated"
                 icon
                 size="56">
            <v-icon size="24">mdi-filter-variant</v-icon>
          </v-btn>
        </div>
      </template>
      <div class="modern-filter-menu">
        <div class="filter-menu-header">
          <v-icon color="#3b82f6" size="18">mdi-filter-variant</v-icon>
          <span class="filter-menu-title">筛选条件</span>
        </div>
        <div class="filter-options">
          <div v-for="(item, index) in filterStatus"
               :key="index"
               class="filter-option"
               :class="{ 'filter-selected': filter.status === item }"
               @click="onFilterChange(index)">
            <div class="filter-option-content">
              <v-icon class="filter-option-icon"
                      :color="filter.status === item ? '#3b82f6' : '#6b7280'"
                      size="16">
                {{ getFilterIcon(item) }}
              </v-icon>
              <span class="filter-option-text">{{ item }}</span>
            </div>
            <v-icon v-if="filter.status === item"
                    color="#3b82f6"
                    size="16">
              mdi-check
            </v-icon>
          </div>
        </div>
      </div>
    </v-menu>
  </div>
</template>

<script>

export default {
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
        "page_size": 9999
      },
      filterForJudge: {
        "uin": -1,
        "status": "待审核", // 状态
        "time_order": -1, // 时间排序
        "page": 1,
        "page_size": 10
      },
      posts: [],
      filterStatus: ['全部', '待审核', '已通过', '已拒绝', '已取消', '队列中', '已发布', '失败', '待撤回', '已撤回'],
      tab: '1',
      judgePosts: [],
      judgePages: 1,
      judgeCurrentPage: 1,
      pullLoading: false,
    }
  },

  // watch tab
  watch: {
    tab: function (val) {
      if (val === '1') {
        this.getPosts()
      } else if (val === '3') {
        this.getJudgePosts()
      }
    }
  },

  mounted() {
  },

  methods: {
    onFilterChange(e) {
      // console.log(e)
      let status = this.filterStatus[e.id]
      if (this.tab === '1') {
        this.filter.status = status
        this.getPosts()
      } else if (this.tab === '3') {
        this.filterForJudge.status = status
        this.getJudgePosts()
      }
    },
    updateJudgePost(p) {
      if (p.status === "通过") {
        p.status = 'approve'
      } else if (p.status === "拒绝") {
        p.status = 'reject'
        if (p.reason === "") {
          p.reason = "无理由"
        }
      } else if (p.status === "无理由拒绝") {
        p.status = 'reject'
        p.reason = "无理由"
      }

      let form = {
        "post_id": p.id,
        "option": p.status,
        "comment": p.reason
      }

      this.$axios.post('/v1/post/review-post', form)
        .then((response) => {
          if (response.data.code === 0) {
            this.toast('已经将该稿件' + p.status, 'success')
            this.refreshPosts()
          } else {
            this.toast('操作失败：' + response.data.msg)
          }
        })
        .catch((error) => {
          this.toast('操作失败：' + error.response.data.msg)
          console.error(error)
        })
    },
    refreshPosts() {
      if (this.tab === '1') {
        this.getPosts()
      } else if (this.tab === '3') {
        this.getJudgePosts()
      }
    },
    getJudgePosts() {
      console.log(this.filterForJudge)
      // 检查status
      let filter = JSON.parse(JSON.stringify(this.filterForJudge))
      for (let key in this.$store.state.statusMap) {
        if (this.$store.state.statusMap[key] === this.filterForJudge.status) {
          filter.status = key
          break
        }
      }

      filter.page = this.judgeCurrentPage

      this.pullLoading = true
      this.$axios.post('/v1/post/get-posts', filter)
        .then((response) => {
          if (response.data.code === 0) {
            let p = response.data.data.list
            if (p === null) {
              this.toast('无记录')
              this.judgePosts = []
              this.pullLoading = false
              return
            }
            for (let i = 0; i < p.length; i++) {
              // 2024-04-12T08:19:51.096Z 转成日期，再转成字符串
              let date = new Date(p[i].created_at)
              p[i].created_at = date.toLocaleString()
              p[i].status = this.$store.state.statusMap[p[i].status]
              for (let j = 0; j < p[i].images.length; j++) {
                p[i].images[j] = this.$store.state.base_url + "/v1/post/download-image/" + p[i].images[j] + "?preview=1"
              }
            }
            console.log(p)
            this.judgePosts = p

            // 计算页数
            this.judgePages = Math.ceil(response.data.data.total / this.filterForJudge.page_size)
          } else {
            this.toast(response.data.msg)
          }
          this.pullLoading = false
          console.log(response.data)
        })
        .catch((error) => {
          this.pullLoading = false
          if (error.response.data.code === -1) {
            this.$router.push('/auth?hint=请先登录嗷')
            return
          }
          this.toast('获取稿件失败')
          console.log(error)
        })
    },
    getPosts() {
      console.log(this.filter)
      // 检查status
      let filter = JSON.parse(JSON.stringify(this.filter))
      for (let key in this.$store.state.statusMap) {
        if (this.$store.state.statusMap[key] === this.filter.status) {
          filter.status = key
          break
        }
      }
      this.pullLoading = true
      this.$axios.post('/v1/post/get-self-posts', filter)
        .then((response) => {
          if (response.data.code === 0) {
            let p = response.data.data.list
            if (p === null) {
              this.toast('无记录')
              this.posts = []
              this.pullLoading = false
              return
            }
            // reverse
            p.reverse()
            for (let i = 0; i < p.length; i++) {
              // 2024-04-12T08:19:51.096Z 转成日期，再转成字符串，转成 YYYY-MM-DD HH:MM:SS UTC+8
              let date = new Date(p[i].created_at)
              p[i].created_at = date.toLocaleString()
              p[i].status = this.$store.state.statusMap[p[i].status]
              for (let j = 0; j < p[i].images.length; j++) {
                p[i].images[j] = this.$store.state.base_url + "/v1/post/download-image/" + p[i].images[j] + "?preview=1"
              }
            }
            console.log(p)
            this.posts = p
          } else {
            this.toast(response.data.msg)
          }
          this.pullLoading = false
          console.log(response.data)
        })
        .catch((error) => {
          this.pullLoading = false
          this.toast(error)
          // if (error.response.data.code === -1) {
          //   this.$router.push('/auth?hint=请先登录嗷')
          //   return
          // }
          console.log(error)
        })
    },
    toast(text, color = 'error') {
      this.snackbar.text = text
      this.snackbar.color = color
      this.snackbar.show = true
    },
    recallPost(post) {
      console.log(post)
      this.$axios.post('/v1/post/user-cancel', {
        "post_id": post
      })
        .then((response) => {
          if (response.data.code === 0) {
            this.toast('取消成功', 'success')
            this.getPosts()
          } else {
            this.toast('取消失败：' + response.data.msg)
          }
        })
        .catch((error) => {
          this.toast('取消失败：' + error.response.data.msg)
          console.error(error)
        })
    },
    getFilterIcon(status) {
      const iconMap = {
        '全部': 'mdi-view-list',
        '待审核': 'mdi-clock-outline',
        '已通过': 'mdi-check-circle',
        '已拒绝': 'mdi-close-circle',
        '已取消': 'mdi-cancel',
        '队列中': 'mdi-timer-sand',
        '已发布': 'mdi-publish',
        '失败': 'mdi-alert-circle',
        '待撤回': 'mdi-undo-variant',
        '已撤回': 'mdi-backup-restore'
      }
      return iconMap[status] || 'mdi-circle-outline'
    },
  }
}
</script>

<style scoped>
/* 稿件页面整体布局 */
.world-page-container {
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
  max-width: 600px;
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
  max-width: 600px;
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
  gap: 8px;
}

.action-btn {
  border-color: #e2e8f0 !important;
  color: #64748b !important;
}

/* 稿件容器 */
.posts-container {
  padding: 20px;
}

.posts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.post-card {
  border-radius: 12px;
  overflow: hidden;
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

#container-wrap {
  min-height: 74vh;
}

/* 即将上线页面 */
.coming-soon {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  padding: 40px 20px;
}

.coming-soon-content {
  text-align: center;
  max-width: 400px;
}

.coming-soon-title {
  font-size: 24px;
  font-weight: 600;
  color: #1e293b;
  margin: 20px 0 12px;
}

.coming-soon-desc {
  color: #64748b;
  font-size: 16px;
  margin-bottom: 32px;
}

.coming-soon-features {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #374151;
  font-size: 14px;
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

/* 浮动筛选按钮 */
.floating-filter-btn {
  position: fixed;
  right: 20px;
  bottom: 100px;
  z-index: 100;
}

.filter-btn {
  background: linear-gradient(135deg, #3b82f6, #1d4ed8) !important;
  color: white !important;
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4) !important;
  border-radius: 50% !important;
  width: 56px !important;
  height: 56px !important;
  transition: all 0.3s ease !important;
}

.filter-btn:hover {
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 25px rgba(59, 130, 246, 0.5) !important;
}

/* 现代化筛选菜单 */
.modern-filter-menu {
  background: white;
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  min-width: 200px;
  max-width: 250px;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.filter-menu-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  border-bottom: 1px solid #e2e8f0;
}

.filter-menu-title {
  font-weight: 600;
  color: #1e293b;
  font-size: 14px;
}

.filter-options {
  padding: 8px 0;
  max-height: 300px;
  overflow-y: auto;
}

.filter-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
}

.filter-option:hover {
  background: rgba(59, 130, 246, 0.05);
  border-left-color: rgba(59, 130, 246, 0.2);
}

.filter-selected {
  background: rgba(59, 130, 246, 0.1) !important;
  border-left-color: #3b82f6 !important;
}

.filter-option-content {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.filter-option-icon {
  flex-shrink: 0;
  background: rgba(107, 114, 128, 0.1);
  border-radius: 6px;
  padding: 4px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.filter-selected .filter-option-icon {
  background: rgba(59, 130, 246, 0.15);
}

.filter-option-text {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.filter-selected .filter-option-text {
  color: #3b82f6;
  font-weight: 600;
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

  .modern-tabs-container {
    padding: 0 16px;
    top: 60px;
  }

  .tabs-wrapper {
    gap: 4px;
  }

  .tab-item {
    padding: 12px 16px;
    gap: 6px;
  }

  .tab-label {
    font-size: 13px;
  }

  .main-content {
    padding: 16px;
  }

  .section-header {
    padding: 16px;
  }

  .section-title {
    font-size: 16px;
  }

  .posts-container {
    padding: 16px;
  }

  .coming-soon {
    padding: 30px 16px;
  }

  .coming-soon-title {
    font-size: 20px;
  }

  .coming-soon-desc {
    font-size: 14px;
  }

  .floating-filter-btn {
    right: 16px;
    bottom: 90px;
  }

  .filter-btn {
    width: 48px !important;
    height: 48px !important;
  }

  .modern-filter-menu {
    min-width: 180px;
    max-width: 220px;
  }

  .filter-menu-header {
    padding: 14px 16px;
  }

  .filter-option {
    padding: 10px 16px;
  }

  .filter-option-content {
    gap: 10px;
  }

  .filter-option-icon {
    width: 20px;
    height: 20px;
  }

  .filter-option-text {
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
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .posts-container {
    padding: 14px;
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

  .coming-soon {
    padding: 20px 12px;
  }

  .coming-soon-title {
    font-size: 18px;
  }

  .coming-soon-desc {
    font-size: 13px;
  }

  .floating-filter-btn {
    right: 12px;
    bottom: 80px;
  }

  .filter-btn {
    width: 44px !important;
    height: 44px !important;
  }

  .modern-filter-menu {
    min-width: 160px;
    max-width: 200px;
  }

  .filter-menu-header {
    padding: 12px 14px;
  }

  .filter-menu-title {
    font-size: 13px;
  }

  .filter-option {
    padding: 8px 14px;
  }

  .filter-option-content {
    gap: 8px;
  }

  .filter-option-icon {
    width: 18px;
    height: 18px;
  }

  .filter-option-text {
    font-size: 12px;
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