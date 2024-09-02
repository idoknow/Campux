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
          { text: '最简部署', link: '/deploy/minimal' },
          { text: '初始化和维护', link: '/deploy/maintain' },
          { text: '配置文件', link: '/deploy/config' },
          { text: '生产级部署', link: '/deploy/production' },
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
          { text: 'Campux 前后端', link: '/develop/campux' },
          { text: 'CampuxBot', link: '/develop/bot' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/idoknow/Campux' }
    ]
  }
})
