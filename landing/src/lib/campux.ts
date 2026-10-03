/**
 * Campux 官网统一链接与图片资源
 */

const DOCS_BASE = 'https://docs.campux.top';

export const LINKS = {
  github: 'https://github.com/idoknow/Campux',
  cloud: 'https://app.campux.top',
  docsSite: DOCS_BASE,

  docs: {
    intro: `${DOCS_BASE}/intro`,
    selfService: `${DOCS_BASE}/operator/self-service-onboarding`,
    quickstart: `${DOCS_BASE}/getting-started`,
    singleBinary: `${DOCS_BASE}/admin/standalone-binary`,
    workbench: `${DOCS_BASE}/operator/overview`,
    reviewPublish: `${DOCS_BASE}/operator/review-and-publish`,
    bots: `${DOCS_BASE}/operator/bots`,
    onebot: `${DOCS_BASE}/reference/onebot`,
    ops: `${DOCS_BASE}/admin/overview`,
    tenant: `${DOCS_BASE}/admin/tenant-lifecycle`,
    security: `${DOCS_BASE}/admin/security`,
    accounts: `${DOCS_BASE}/admin/accounts`,
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

/** 官方 Telegram 交流群 */
export const TELEGRAM_GROUPS = [
  {
    name: 'Campux Telegram 交流群',
    description: '加入 Telegram 交流群，获取使用反馈与接入支持',
    href: 'https://t.me/+uSANsIhvIEY2ZGI1',
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
