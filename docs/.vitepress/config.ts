import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Campux",
  description: "Open-source campus wall operations platform",
  lang: "zh-CN",
  cleanUrls: true,
  // Absolute base used for canonical / OG URLs and sitemap entries.
  sitemap: {
    hostname: "https://docs.campux.top",
    // The root URL only redirects to /intro; drop it so /intro is the single
    // indexed entry point.
    transformItems: (items) => items.filter((item) => item.url !== "" && item.url !== "/"),
  },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["link", { rel: "apple-touch-icon", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#0190D5" }],
    ["meta", { name: "author", content: "Campux" }],
    ["meta", { name: "keywords", content: "Campux,校园墙,校园墙系统,校园墙运营,开源校园墙,投稿审核,QZone 发布,OneBot,自托管,文档" }],
    // Global Open Graph / Twitter defaults; per-page title/description/url/canonical
    // are injected in transformPageData below.
    ["meta", { property: "og:site_name", content: "Campux 文档" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:locale", content: "zh_CN" }],
    ["meta", { property: "og:image", content: "https://campux.top/assets/og-image.png" }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: "https://campux.top/assets/og-image.png" }],
  ],
  // Inject per-page canonical + Open Graph URL/title/description so every doc
  // page is independently shareable and indexable.
  transformPageData(pageData) {
    // The root index.md only redirects to /intro and sets its own
    // noindex + canonical in frontmatter — don't double-inject here.
    if (pageData.relativePath === "index.md") return;
    const base = "https://docs.campux.top";
    const path = pageData.relativePath.replace(/(index)?\.md$/, "").replace(/\/$/, "");
    const url = path ? `${base}/${path}` : `${base}/`;
    const title = pageData.frontmatter.title || pageData.title || "Campux 文档";
    const description =
      pageData.frontmatter.description ||
      pageData.description ||
      "Campux 开源校园墙运营系统文档：自助开墙、审核发布、机器人、自托管部署与运维。";
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push(
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
    );
  },
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
          { text: "项目介绍", link: "/intro" },
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
          { text: "匿名遥测", link: "/admin/telemetry" },
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
