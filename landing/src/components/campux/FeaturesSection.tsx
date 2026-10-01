import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CheckCircle2,
  LogIn,
  MessageCircleHeart,
  Send,
  Share2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { IMAGES } from '@/lib/campux';
import { Reveal } from './Reveal';
import { SectionHeading } from './WhySection';
import { BrowserWindow } from './BrowserWindow';

/** 五个功能行数据（含要点清单） */
const FEATURE_ROWS: Array<{
  icon: LucideIcon;
  name: string;
  title: string;
  description: string;
  points: string[];
  image: string;
  imageAlt: string;
  windowTitle: string;
}> = [
  {
    icon: Send,
    name: '投稿',
    title: '网页、私聊双重投稿渠道',
    description:
      '网页端和 QQ 私聊墙号机器人均可投稿，两个入口统一进入同一条审核流程。',
    points: ['网页端表单投稿', 'QQ 私聊墙号机器人', '双入口统一审核流程'],
    image: IMAGES.featureSubmission,
    imageAlt: '网页与 QQ 私聊双渠道投稿界面',
    windowTitle: 'campux · 投稿',
  },
  {
    icon: Share2,
    name: '发布',
    title: '自动发表到空间，支持单条 / 多条',
    description:
      '稿件通过审核后自动发表到 QQ 空间，既支持单条即时发布，也支持多条稿件合并为一条说说发布；失败可重试，发布日志可追溯。',
    points: ['单条即时发布', '多条合并为一条说说', '失败可重试 · 日志可追溯'],
    image: IMAGES.featurePublish,
    imageAlt: '稿件自动发布到 QQ 空间的发布界面',
    windowTitle: 'campux · 发布',
  },
  {
    icon: LogIn,
    name: '登录态',
    title: '自动获取登录信息，省心快捷',
    description:
      '协议自动获取与扫码登录两种方式维护 QZone 登录态，定时检测、失效自动刷新，无需手动抓取 cookies。',
    points: ['协议自动获取登录信息', '扫码登录兜底', '定时检测 · 失效自动刷新'],
    image: IMAGES.featureLogin,
    imageAlt: 'QZone 扫码登录与登录态检测界面',
    windowTitle: 'campux · 登录态',
  },
  {
    icon: BarChart3,
    name: '统计',
    title: '投稿量、访客量统计图表',
    description:
      '统计看板以图表展示投稿量、空间访客量等运营数据，支持多时间范围切换，活跃度与发布质量一目了然。',
    points: ['投稿量 / 访客量图表', '多时间范围切换', '活跃度与发布质量一目了然'],
    image: IMAGES.featureStats,
    imageAlt: '投稿量与访客量统计图表看板',
    windowTitle: 'campux · 统计',
  },
  {
    icon: MessageCircleHeart,
    name: '互动',
    title: '评论同步展示、定时通知投稿人',
    description:
      'QQ 空间评论自动同步到站内稿件页展示；投稿人关注自己的稿件后，会定时收到新评论摘要的私聊通知。',
    points: ['评论同步到稿件页', '投稿人可关注稿件', '定时私聊推送评论摘要'],
    image: IMAGES.featureComments,
    imageAlt: '空间评论同步与投稿人通知界面',
    windowTitle: 'campux · 互动',
  },
];

interface FeaturesSectionProps {
  onImageClick: (src: string, title: string) => void;
}

/** 核心功能：五个左右交替的功能行，配要点清单与界面截图 */
export function FeaturesSection({ onImageClick }: FeaturesSectionProps) {
  return (
    <section id="features" className="relative py-20 md:py-28">
      {/* 区块底色区分 */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-secondary/40 to-transparent"
      />
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <Reveal>
          <SectionHeading
            eyebrow="核心功能"
            title="覆盖运营全流程"
            subtitle="从双投稿渠道到自动发布、登录态维护、数据统计与评论回流。"
          />
        </Reveal>

        <div className="flex flex-col gap-16 md:gap-24">
          {FEATURE_ROWS.map((row, index) => {
            const reversed = index % 2 === 1;
            return (
              <Reveal key={row.name}>
                <div className="grid items-center gap-8 md:gap-12 lg:grid-cols-2">
                  {/* 文案 */}
                  <div className={cn(reversed && 'lg:order-2')}>
                    <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm font-semibold text-secondary-foreground">
                      <row.icon aria-hidden="true" className="h-4 w-4 text-primary" />
                      {row.name}
                    </span>
                    <h3 className="mt-4 font-heading text-2xl font-bold tracking-tight text-balance md:text-3xl">
                      {row.title}
                    </h3>
                    <p className="mt-4 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground">
                      {row.description}
                    </p>
                    {/* 要点清单 */}
                    <ul className="mt-5 flex flex-col gap-2.5">
                      {row.points.map((point) => (
                        <li
                          key={point}
                          className="flex items-center gap-2.5 text-sm text-foreground/80"
                        >
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 text-mint"
                          />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* 截图 */}
                  <div className={cn('relative', reversed && 'lg:order-1')}>
                    <div
                      aria-hidden="true"
                      className={cn(
                        'absolute -inset-3 rounded-3xl blur-2xl',
                        reversed ? 'bg-lilac/10' : 'bg-primary/10'
                      )}
                    />
                    <BrowserWindow
                      title={row.windowTitle}
                      src={row.image}
                      alt={row.imageAlt}
                      aspectClassName="aspect-[16/10]"
                      onImageClick={() => onImageClick(row.image, row.windowTitle)}
                      className={cn(
                        'relative transition-transform duration-500',
                        reversed
                          ? 'rotate-[-0.6deg] hover:rotate-0'
                          : 'rotate-[0.6deg] hover:rotate-0'
                      )}
                    />
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
