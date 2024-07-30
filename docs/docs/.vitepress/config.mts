import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Campux 文档",
  description: "校园墙自动化和校内服务统一认证解决方案",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config

    nav: [
      { text: 'Home', link: '/' },
    ],

    sidebar: [
      {
        text: '概述',
        items: [
          { text: '概述', link: '/insight/intro' },
          { text: '认识 & 场景', link: '/insight/scenario' },
          { text: '组件', link: '/insight/component' }
        ]
      },
      {
        text: '私有化部署',
        items: [
          { text: '环境 & 外部组件', link: '/deploy/env'},
          { text: '系统组件', link: '/deploy/campux' },
          { text: '对外提供服务', link: '/deploy/expose' }
        ]
      },
      {
        text: '行为和维护',
        items: [
          { text: 'Campux 前后端和系统配置', link: '/usage/campux' },
          { text: 'CampuxBot', link: '/usage/bot' },
        ]
      },
      {
        text: '扩展',
        items: [
          { text: 'OAuth 2.0', link: '/extension/oauth' }
        ]
      },
      {
        text: '开发',
        items: [
          { text: 'Campux 前后端', link: '/develop/campux' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/idoknow/Campux' }
    ]
  }
})
