import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Campux",
  description: "Open-source campus wall operations platform",
  lang: "zh-CN",
  cleanUrls: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["link", { rel: "apple-touch-icon", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#0190D5" }],
  ],
  markdown: {
    config(md) {
      const defaultFence = md.renderer.rules.fence?.bind(md.renderer.rules);

      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const language = token.info.trim().split(/\s+/)[0];

        if (language === "mermaid") {
          return `<Mermaid code="${encodeURIComponent(token.content)}" />`;
        }

        return defaultFence?.(tokens, idx, options, env, self) ?? "";
      };
    },
  },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "开始", link: "/operator/self-service-onboarding" },
      { text: "运营", link: "/operator/overview" },
      { text: "参考", link: "/reference/configuration" },
      { text: "系统维护", link: "/admin/overview" },
    ],
    sidebar: [
      {
        text: "开始",
        items: [
          { text: "项目介绍", link: "/" },
          { text: "自助开墙流程", link: "/operator/self-service-onboarding" },
          { text: "系统模型", link: "/concepts" },
        ],
      },
      {
        text: "校园墙运营",
        items: [
          { text: "运营工作台", link: "/operator/overview" },
          { text: "审核与发布", link: "/operator/review-and-publish" },
          { text: "机器人管理", link: "/operator/bots" },
          { text: "发布目标与 QZone", link: "/operator/publishing" },
          { text: "成员、封禁与配置", link: "/operator/members-and-settings" },
          { text: "统计看板", link: "/operator/stats" },
        ],
      },
      {
        text: "参考",
        items: [
          { text: "配置项", link: "/reference/configuration" },
          { text: "OneBot 接入", link: "/reference/onebot" },
          { text: "系统架构", link: "/reference/architecture" },
          { text: "发布状态", link: "/reference/publish-states" },
        ],
      },
      {
        text: "系统维护（自托管）",
        items: [
          { text: "快速开始", link: "/getting-started" },
          { text: "运维面板", link: "/admin/overview" },
          { text: "租户生命周期", link: "/admin/tenant-lifecycle" },
          { text: "账号与权限", link: "/admin/accounts" },
          { text: "部署与升级", link: "/admin/deployment" },
          { text: "安全基线", link: "/admin/security" },
          { text: "故障排查", link: "/admin/troubleshooting" },
        ],
      },
      {
        text: "参与开发",
        items: [
          { text: "本地开发", link: "/contributing/local-development" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/idoknow/Campux" }],
    search: {
      provider: "local",
    },
  },
});
