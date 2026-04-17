<template>
    <div class="modern-bottom-nav">
        <div class="nav-container">
            <div class="nav-item" :class="{ 'nav-active': $route.path === '/' }" @click="go('/')">
                <div class="nav-icon">
                    <v-icon :color="$route.path === '/' ? '#3b82f6' : '#6b7280'" size="20">mdi-pencil</v-icon>
                </div>
                <span class="nav-label" :class="{ 'label-active': $route.path === '/' }">投稿</span>
            </div>

            <div class="nav-item" :class="{ 'nav-active': $route.path === '/world' }" @click="go('/world')">
                <div class="nav-icon">
                    <v-icon :color="$route.path === '/world' ? '#3b82f6' : '#6b7280'" size="20">mdi-earth</v-icon>
                </div>
                <span class="nav-label" :class="{ 'label-active': $route.path === '/world' }">稿件</span>
            </div>

            <div class="nav-item" :class="{ 'nav-active': $route.path === '/service' }" @click="go('/service')">
                <div class="nav-icon">
                    <v-icon :color="$route.path === '/service' ? '#3b82f6' : '#6b7280'" size="20">mdi-cog</v-icon>
                </div>
                <span class="nav-label" :class="{ 'label-active': $route.path === '/service' }">服务</span>
            </div>

            <div class="nav-item"
                 :class="{ 'nav-active': $route.path === '/admin' }"
                 @click="go('/admin')"
                 v-if="$store.state.account.userGroup === 'admin' || $store.state.account.userGroup === 'member'">
                <div class="nav-icon">
                    <v-icon :color="$route.path === '/admin' ? '#3b82f6' : '#6b7280'" size="20">mdi-shield-account</v-icon>
                </div>
                <span class="nav-label" :class="{ 'label-active': $route.path === '/admin' }">管理</span>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        value: {
            type: Number,
            default: 0
        }
    },
    data() {
        return {
        }
    },
    methods: {
        go(path) {
            this.$router.push(path);
        }
    }
}
</script>

<style scoped>
.modern-bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(20px);
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
}

.nav-container {
    display: flex;
    justify-content: space-around;
    align-items: center;
    max-width: 600px;
    margin: 0 auto;
    padding: 0 16px;
}

.nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 12px;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    min-width: 60px;
    position: relative;
}

.nav-item:active {
    transform: scale(0.95);
}

.nav-active {
    background: rgba(59, 130, 246, 0.1);
}

.nav-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin-bottom: 4px;
    transition: all 0.2s ease;
}

.nav-label {
    font-size: 11px;
    font-weight: 500;
    color: #6b7280;
    transition: color 0.2s ease;
    text-align: center;
    line-height: 1.2;
}

.label-active {
    color: #3b82f6;
    font-weight: 600;
}

/* 活跃状态指示器 */
.nav-active::before {
    content: '';
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 20px;
    height: 3px;
    background: #3b82f6;
    border-radius: 2px;
}

/* 移动端优化 */
@media (max-width: 480px) {
    .nav-container {
        padding: 0 8px;
    }

    .nav-item {
        padding: 6px 8px;
        min-width: 50px;
    }

    .nav-icon {
        width: 24px;
        height: 24px;
        margin-bottom: 2px;
    }

    .nav-label {
        font-size: 10px;
    }
}

/* 适配安全区域 */
@supports (padding: max(0px)) {
    .modern-bottom-nav {
        padding-bottom: max(8px, env(safe-area-inset-bottom));
    }
}
</style>