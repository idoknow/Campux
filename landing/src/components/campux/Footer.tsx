import { ExternalLink, Github, Heart, MessageCircle } from 'lucide-react';
import { LINKS, QQ_GROUPS } from '@/lib/campux';

/** 页脚链接列数据 */
const FOOTER_COLUMNS = [
  {
    title: '产品',
    links: [
      { label: '核心功能', href: '#features' },
      { label: '产品界面', href: '#showcase' },
      { label: '登录控制台', href: LINKS.cloud, external: true },
    ],
  },
  {
    title: '文档',
    links: [
      { label: '项目介绍', href: LINKS.docs.intro, external: true },
      { label: '自助开墙', href: LINKS.docs.selfService, external: true },
      { label: '部署快速开始', href: LINKS.docs.quickstart, external: true },
    ],
  },
  {
    title: '开源',
    links: [
      { label: 'GitHub 仓库', href: LINKS.github, external: true },
      { label: '参与开发', href: `${LINKS.github}/CONTRIBUTING.md`, external: true },
      { label: '匿名遥测', href: `${LINKS.docsSite}/privacy.html`, external: true },
    ],
  },
];

/** 页脚：品牌区 + 三列链接 + 渐变装饰线 + 版权栏 */
export function Footer() {
  return (
    <footer className="relative mt-4">
      {/* 顶部渐变装饰线 */}
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-primary/60 to-transparent"
      />
      {/* 背景柔光 */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-primary/5"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-1/2 -z-10 h-64 w-[60rem] max-w-none -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="mx-auto max-w-6xl px-4 pb-8 pt-14 md:px-6 md:pt-20">
        <div className="grid gap-10 md:grid-cols-[1.2fr_2fr] md:gap-12 lg:gap-16">
          {/* 左侧品牌区 */}
          <div className="max-w-sm">
            <a href="#top" className="inline-flex items-center gap-2.5">
              <img src="/assets/logo.svg" alt="Campux" className="h-7 w-auto" />
              <span className="font-heading text-lg font-bold text-foreground">
                Camp<span className="text-primary">ux</span>
              </span>
            </a>
            <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground">
              开源校园墙运营系统。投稿、审核、Bot、发布与运维一体化。
            </p>

            {/* 社交按钮 */}
            <div className="mt-5 flex items-center gap-2.5">
              <a
                href={LINKS.github}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub 仓库"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary hover:shadow-card"
              >
                <Github className="h-4.5 w-4.5" />
              </a>
              <a
                href={QQ_GROUPS[0].href}
                target="_blank"
                rel="noreferrer"
                aria-label="Campux App 用户组 QQ 交流群"
                title={`用户组 · 群号 ${QQ_GROUPS[0].number}`}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary hover:shadow-card"
              >
                <MessageCircle className="h-4.5 w-4.5" />
              </a>
            </div>


          </div>

          {/* 右侧三列链接 */}
          <nav
            aria-label="页脚导航"
            className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:gap-10"
          >
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title} className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
                <ul className="mt-4 space-y-3">
                  {column.links.map((link) => (
                    <li key={link.label} className="min-w-0">
                      <a
                        href={link.href}
                        {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                        className="inline-flex max-w-full items-center gap-1 break-words text-sm text-muted-foreground transition-all duration-300 hover:translate-x-0.5 hover:text-primary"
                      >
                        {link.label}
                        {link.external && (
                          <ExternalLink
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 opacity-50"
                          />
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* 底部版权栏 */}
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border/70 pt-6 text-sm text-muted-foreground md:mt-16 md:flex-row">
          <p>© 2026 Campux · 开源校园墙运营系统</p>
          <p className="flex items-center gap-1.5">
            <Heart aria-hidden="true" className="h-4 w-4 text-chart-5" />
            Powered by Campux
          </p>
        </div>
      </div>
    </footer>
  );
}
