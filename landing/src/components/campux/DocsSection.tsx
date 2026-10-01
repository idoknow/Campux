import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  BookOpen,
  Rocket,
  ServerCog,
  UserRound,
} from 'lucide-react';
import { LINKS } from '@/lib/campux';
import { Reveal } from './Reveal';
import { SectionHeading } from './WhySection';

interface DocLink {
  label: string;
  href: string;
}

interface DocGroup {
  role: string;
  icon: LucideIcon;
  description: string;
  ordered: boolean;
  items: Array<{ title: string; note: string; links: DocLink[] }>;
}

/** 文档路径分组 */
const DOC_GROUPS: DocGroup[] = [
  {
    role: '校园墙运营管理员',
    icon: UserRound,
    description: '面向日常投稿、审核与发布运营的同学。',
    ordered: true,
    items: [
      {
        title: '自助开墙',
        note: '先读《自助开墙流程》。',
        links: [{ label: '自助开墙流程', href: LINKS.docs.selfService }],
      },
      {
        title: '接手校园墙',
        note: '读《运营工作台》和《审核与发布》。',
        links: [
          { label: '运营工作台', href: LINKS.docs.workbench },
          { label: '审核与发布', href: LINKS.docs.reviewPublish },
        ],
      },
      {
        title: '接入机器人',
        note: '读《机器人管理》和《OneBot 接入》。',
        links: [
          { label: '机器人管理', href: LINKS.docs.bots },
          { label: 'OneBot 接入', href: LINKS.docs.onebot },
        ],
      },
    ],
  },
  {
    role: '系统维护者（自托管）',
    icon: ServerCog,
    description: '面向自己部署与维护 Campux 实例的同学。',
    ordered: false,
    items: [
      {
        title: '部署上手',
        note: '《快速开始》，或《单文件部署》（零依赖，内置 SQLite + 本地存储）。',
        links: [
          { label: '快速开始', href: LINKS.docs.quickstart },
          { label: '单文件部署', href: LINKS.docs.singleBinary },
        ],
      },
      {
        title: '运维与多租户',
        note: '《运维面板》、《租户生命周期》。',
        links: [
          { label: '运维面板', href: LINKS.docs.ops },
          { label: '租户生命周期', href: LINKS.docs.tenant },
        ],
      },
      {
        title: '安全基线',
        note: '《安全基线》与《账号与权限》。',
        links: [
          { label: '安全基线', href: LINKS.docs.security },
          { label: '账号与权限', href: LINKS.docs.accounts },
        ],
      },
    ],
  },
];

/** 文档路径：面向不同角色的阅读路径（渐变数字序号徽章 + 文档链接 chips） */
export function DocsSection() {
  return (
    <section id="docs" className="relative py-20 md:py-28">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-secondary/40 to-transparent"
      />
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <Reveal>
          <SectionHeading
            eyebrow="从这里开始"
            title="面向不同角色的文档"
            subtitle="文档主要面向校园墙运营管理员，同时覆盖自托管系统维护者。"
          />
        </Reveal>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
          {DOC_GROUPS.map((group) => {
            const ListTag = group.ordered ? 'ol' : 'ul';
            return (
              <Reveal key={group.role}>
                <article className="h-full rounded-3xl border border-border/70 bg-card p-6 shadow-card md:p-8">
                  <header className="flex items-center gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary">
                      <group.icon aria-hidden="true" className="h-5.5 w-5.5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-xl font-bold text-foreground">
                        {group.role}
                      </h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {group.description}
                      </p>
                    </div>
                  </header>

                  <ListTag className="mt-7 flex flex-col gap-6">
                    {group.items.map((item, index) => (
                      <li key={item.title} className="flex min-w-0 gap-3.5">
                        {/* 渐变数字序号徽章 */}
                        <span
                          aria-hidden="true"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-chart-3 text-xs font-bold tabular-nums text-primary-foreground shadow-sm shadow-primary/25"
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-base font-semibold text-foreground">
                            {item.title}
                          </h4>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {item.note}
                          </p>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {item.links.map((link) => (
                              <a
                                key={link.label}
                                href={link.href}
                                target="_blank"
                                rel="noreferrer"
                                className="group/chip inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:border-primary/40 hover:bg-secondary"
                              >
                                <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
                                {link.label}
                                <ArrowUpRight
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5 opacity-60 transition-transform duration-300 group-hover/chip:translate-x-0.5 group-hover/chip:-translate-y-0.5"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ListTag>
                </article>
              </Reveal>
            );
          })}
        </div>

        {/* 快捷入口提示 */}
        <Reveal delay={120}>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border bg-card/50 px-6 py-5 text-center sm:flex-row md:gap-4">
            <Rocket aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              所有文档均托管在独立的文档站，点击上方链接即可前往对应页面。
            </p>
            <a
              href={LINKS.docsSite}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex shrink-0 items-center gap-1 rounded-full text-sm font-semibold text-primary hover:underline"
            >
              前往文档站
              <ArrowUpRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
