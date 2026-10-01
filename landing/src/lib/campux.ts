/**
 * Campux 官网统一链接与图片资源
 */

const DOCS_BASE = 'https://docs.campux.top';

export const LINKS = {
  github: 'https://github.com/campux',
  cloud: 'https://app.campux.top',
  docsSite: DOCS_BASE,

  docs: {
    intro: DOCS_BASE,
    selfService: `${DOCS_BASE}/guide/self-service.html`,
    quickstart: `${DOCS_BASE}/guide/quickstart.html`,
    singleBinary: `${DOCS_BASE}/guide/single-binary.html`,
    workbench: `${DOCS_BASE}/guide/workbench.html`,
    reviewPublish: `${DOCS_BASE}/guide/review-publish.html`,
    bots: `${DOCS_BASE}/guide/bots.html`,
    onebot: `${DOCS_BASE}/guide/onebot.html`,
    ops: `${DOCS_BASE}/guide/ops.html`,
    tenant: `${DOCS_BASE}/guide/tenant.html`,
    security: `${DOCS_BASE}/guide/security.html`,
    accounts: `${DOCS_BASE}/guide/accounts.html`,
  },
} as const;

/** 官方 QQ 交流群（装有 QQ 客户端的设备点击可直接打开加群卡片） */
export const QQ_GROUPS = [
  {
    name: 'Campux App 用户组',
    number: '1124751247',
    description: '产品反馈与使用交流',
    href: 'mqqapi://card/show_pslcard?src_type=internal&version=1&uin=1124751247&card_type=group&source=qrcode',
  },
  {
    name: 'Campux 技术交流',
    number: '226427026',
    description: '部署、自助开墙与 Bot 接入',
    href: 'mqqapi://card/show_pslcard?src_type=internal&version=1&uin=226427026&card_type=group&source=qrcode',
  },
] as const;

/** 界面截图资源 */
export const IMAGES = {
  heroReview: '/assets/screenshots/review-board.png',
  featureSubmission: '/assets/screenshots/features/submission-channels.png',
  featurePublish: '/assets/screenshots/features/auto-publish.png',
  featureLogin: '/assets/screenshots/features/auto-login.png',
  featureStats: '/assets/screenshots/features/stats-charts.png',
  featureComments: '/assets/screenshots/features/comment-sync.png',
  showcaseDashboard: '/assets/screenshots/stats-dashboard.png',
  showcaseReview: '/assets/screenshots/review-board.png',
  showcaseOps: '/assets/screenshots/ops-panel.png',
} as const;
