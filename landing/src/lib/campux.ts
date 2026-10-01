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
  heroReview:
    'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_869d0228-2b6d-4e13-b49d-161aaa633cd9.jpg',
  featureSubmission:
    'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_6e0a217a-c12c-4b80-87ad-897aa8b56e53.jpg',
  featurePublish:
    'https://miaoda-site-img.cdn.bcebos.com/images/MiaoTu_04c337fe-3435-487e-817c-eeeecdbb65e2.jpg',
  featureLogin:
    'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_d65a9e21-eb40-4ad0-88f4-41b8839d3692.jpg',
  featureStats:
    'https://miaoda-image.cdn.bcebos.com/img/corpus/dc454d52f0394431a15210b45a489621.jpg',
  featureComments:
    'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_5b98f44b-18a4-487a-8c30-e15a48f1f253.jpg',
  showcaseDashboard:
    'https://miaoda-image.cdn.bcebos.com/img/corpus/366848d01da64b8bac588e2205d94943.jpg',
  showcaseReview:
    'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_acc3cb85-2cce-412c-8548-3e3b84901380.jpg',
  showcaseOps:
    'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_c4add04c-c518-4ff7-9f4b-1409174003c3.jpg',
} as const;
