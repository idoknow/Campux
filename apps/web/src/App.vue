<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { TenantSummary } from "@campux/domain";

const loading = ref(true);
const error = ref("");
const tenants = ref<TenantSummary[]>([]);
const selectedTenantId = ref("tenant-canton");

const selectedTenant = computed(() => {
  return tenants.value.find((tenant) => tenant.id === selectedTenantId.value) ?? tenants.value[0];
});

const publishTargets = [
  {
    name: "一号墙",
    status: "已同步",
    accent: "#e0574f",
    progress: 100,
  },
  {
    name: "二号墙",
    status: "发布中",
    accent: "#f0a23a",
    progress: 64,
  },
  {
    name: "三号墙",
    status: "待重试",
    accent: "#4b8fdd",
    progress: 38,
  },
];

const moderationFeed = [
  {
    title: "校运会失物招领合集",
    meta: "投稿 #4287 · 6 张图片 · 匿名",
    status: "待审核",
  },
  {
    title: "图书馆闭馆音乐投票",
    meta: "投稿 #4288 · 纯文本 · 非匿名",
    status: "待审核",
  },
  {
    title: "南门夜宵摊位营业时间",
    meta: "投稿 #4289 · 2 张图片 · 非匿名",
    status: "发布中",
  },
];

async function fetchTenants() {
  loading.value = true;
  error.value = "";

  try {
    const response = await fetch("/api/tenants");

    if (!response.ok) {
      throw new Error(`请求失败：${response.status}`);
    }

    const data = (await response.json()) as { tenants: TenantSummary[] };
    tenants.value = data.tenants;

    if (data.tenants[0]) {
      selectedTenantId.value = data.tenants[0].id;
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "无法连接到 Campux API";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void fetchTenants();
});
</script>

<template>
  <main class="shell">
    <section class="hero-panel">
      <nav class="topbar" aria-label="主导航">
        <div class="brand-mark" aria-hidden="true">C</div>
        <div>
          <p class="eyebrow">Campux Next</p>
          <h1>多校园墙运营台</h1>
        </div>
        <button class="ghost-button" type="button">新建租户</button>
      </nav>

      <div class="hero-grid">
        <div class="hero-copy">
          <p class="section-kicker">单实例 · 多学校 · 多墙号同步</p>
          <h2>把每所学校的校园墙放进同一个鲜活的工作台。</h2>
          <p class="hero-text">
            CampuxNext 将投稿、审核、QQ 墙号发布和租户配置收束到一个 TypeScript 单体里。
            每个学校可以拥有独立主题，也可以把同一篇稿件同步发到多个 QQ 空间。
          </p>
          <div class="hero-actions">
            <button class="primary-button" type="button">查看发布队列</button>
            <button class="secondary-button" type="button">配置学校墙</button>
          </div>
        </div>

        <aside class="tenant-switcher" aria-label="租户列表">
          <div class="panel-title-row">
            <p class="panel-title">租户</p>
            <span class="live-dot">运行中</span>
          </div>

          <div v-if="loading" class="skeleton-stack" aria-label="正在加载租户">
            <span />
            <span />
            <span />
          </div>

          <p v-else-if="error" class="error-box">{{ error }}</p>

          <button
            v-for="tenant in tenants"
            v-else
            :key="tenant.id"
            class="tenant-row"
            :class="{ active: tenant.id === selectedTenant?.id }"
            type="button"
            @click="selectedTenantId = tenant.id"
          >
            <span class="tenant-color" :style="{ backgroundColor: tenant.themeColor }" />
            <span>
              <strong>{{ tenant.name }}</strong>
              <small>{{ tenant.botAccountCount }} 个墙号 · {{ tenant.pendingPostCount }} 条待处理</small>
            </span>
          </button>
        </aside>
      </div>
    </section>

    <section class="workspace-grid">
      <article class="publish-board">
        <div class="panel-title-row">
          <div>
            <p class="section-kicker">发布同步</p>
            <h3>{{ selectedTenant?.name ?? "租户" }}</h3>
          </div>
          <span class="sync-badge">3 个 QQ 墙号</span>
        </div>

        <div class="target-list">
          <div v-for="target in publishTargets" :key="target.name" class="target-row">
            <div class="target-heading">
              <span class="target-dot" :style="{ backgroundColor: target.accent }" />
              <strong>{{ target.name }}</strong>
              <small>{{ target.status }}</small>
            </div>
            <div class="progress-track">
              <span
                class="progress-fill"
                :style="{ width: `${target.progress}%`, backgroundColor: target.accent }"
              />
            </div>
          </div>
        </div>
      </article>

      <article class="moderation-panel">
        <div class="panel-title-row">
          <div>
            <p class="section-kicker">审核流</p>
            <h3>今天的新稿件</h3>
          </div>
          <button class="icon-button" type="button" aria-label="刷新审核列表">↻</button>
        </div>

        <div class="feed-list">
          <button v-for="item in moderationFeed" :key="item.title" class="feed-row" type="button">
            <span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.meta }}</small>
            </span>
            <em>{{ item.status }}</em>
          </button>
        </div>
      </article>
    </section>
  </main>
</template>
