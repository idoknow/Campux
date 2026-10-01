import type { LucideIcon } from 'lucide-react';
import { Layers, Repeat, Bot, Package } from 'lucide-react';
import { Reveal } from './Reveal';

/** 区块标题组件：eyebrow + 标题 + 渐变装饰下划线 + 副标题 */
interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

export function SectionHeading({ eyebrow, title, subtitle }: SectionHeadingProps) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
      {eyebrow && (
        <span className="mb-4 inline-block rounded-full bg-secondary px-4 py-1 text-xs font-semibold tracking-wide text-secondary-foreground">
          {eyebrow}
        </span>
      )}
      <h2 className="font-heading text-3xl font-bold tracking-tight text-balance md:text-4xl">
        {title}
      </h2>
      <span
        aria-hidden="true"
        className="mx-auto mt-5 block h-1 w-16 rounded-full bg-gradient-to-r from-primary via-chart-3 to-aqua"
      />
      {subtitle && (
        <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/** 四张特性卡数据（含技术标签 chips） */
const FEATURES: Array<{
  icon: LucideIcon;
  title: string;
  description: string;
  chips: string[];
}> = [
  {
    icon: Layers,
    title: '多墙统一管理',
    description:
      '一个实例管理多个校园墙，账号、成员身份、专属 host 和运维面板统一维护。',
    chips: ['专属 host', '成员身份', '运维面板'],
  },
  {
    icon: Repeat,
    title: '审核到发布闭环',
    description:
      '网页审核、审核群命令、QZone 发布、失败重试和详细发布日志串成完整链路。',
    chips: ['网页审核', '群命令', '失败重试', '发布日志'],
  },
  {
    icon: Bot,
    title: 'Bot 原生接入',
    description:
      '支持 OneBot v11 WebSocket，机器人注册、重置密码、审核命令、扫码登录和 cookies 检查。',
    chips: ['OneBot v11', 'WebSocket', '扫码登录'],
  },
  {
    icon: Package,
    title: '面向自托管',
    description:
      '下载单文件可执行即可零依赖起跑（内置 SQLite + 本地存储），也支持 PostgreSQL、S3/MinIO、Docker Compose；启动自动建库 / 迁移。',
    chips: ['SQLite', 'PostgreSQL', 'S3/MinIO', 'Docker'],
  },
];

/** 为什么选 Campux：四张特性卡（序号角标 + 渐变顶边 + 技术 chips） */
export function WhySection() {
  return (
    <section id="why" className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <Reveal>
          <SectionHeading
            title="为校园墙运营而生"
            subtitle="从投稿到发布的完整闭环，配合原生 Bot 接入与面向自托管的部署方式。"
          />
        </Reveal>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 md:gap-6">
          {FEATURES.map(({ icon: Icon, title, description, chips }, index) => (
            <Reveal key={title} delay={index * 90} className="h-full">
              <article className="group relative flex h-full flex-col gap-4 rounded-3xl border border-border/70 bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-hover md:p-7">
                {/* 序号角标 */}
                <span
                  aria-hidden="true"
                  className="absolute right-5 top-5 select-none font-heading text-sm font-bold tabular-nums text-muted-foreground/40 transition-colors duration-300 group-hover:text-primary/50"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                {/* 悬停渐变顶边 */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-gradient-to-r from-primary via-chart-3 to-aqua opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                />

                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-chart-3 text-primary-foreground shadow-md shadow-primary/25 transition-transform duration-300 group-hover:scale-105">
                  <Icon aria-hidden="true" className="h-6 w-6" />
                </span>
                <h3 className="font-heading text-lg font-bold text-foreground">{title}</h3>
                <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
                {/* 技术标签 chips（沉底对齐，保证四卡布局一致） */}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  {chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-300 group-hover:bg-secondary group-hover:text-secondary-foreground"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
