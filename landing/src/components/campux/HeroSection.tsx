import { ArrowRight, CalendarDays, MessageSquareText, Network, Send } from 'lucide-react';
import { LINKS, IMAGES } from '@/lib/campux';
import { Button } from '@/components/ui/button';
import { BrowserWindow } from './BrowserWindow';
import { CloudLogo } from './CloudLogo';

/** Hero 数据亮点 */
const HIGHLIGHTS = [
  { icon: CalendarDays, label: '2022.03', text: '创立' },
  { icon: Network, label: '多墙', text: '统一管理' },
  { icon: MessageSquareText, label: 'OneBot', text: '原生接入' },
  { icon: Send, label: 'QZone', text: '自动发布' },
];

interface HeroSectionProps {
  onImageClick: (src: string, title: string) => void;
}

/** Hero 主视觉区：眉标、渐变大标题、双按钮、数据亮点与审核工作台预览 */
export function HeroSection({ onImageClick }: HeroSectionProps) {
  return (
    <section id="top" className="relative overflow-hidden pb-16 pt-32 md:pb-24 md:pt-44">
      {/* 背景装饰：网格纹理 + 柔光圆 */}
      <div aria-hidden="true" className="bg-grid-fade absolute inset-0" />
      <div
        aria-hidden="true"
        className="absolute -top-32 left-1/2 h-[28rem] w-[42rem] max-w-none -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -right-24 top-40 h-72 w-72 rounded-full bg-aqua/15 blur-3xl"
      />
      {/* 漂浮云朵装饰 */}
      <CloudLogo
        className="pointer-events-none absolute left-[6%] top-[22%] h-8 animate-float opacity-20"
        style={{ animationDelay: '0.4s' }}
      />
      <CloudLogo
        className="pointer-events-none absolute right-[7%] top-[11%] hidden h-10 animate-float opacity-15 md:block"
        style={{ animationDelay: '1.8s' }}
      />
      <CloudLogo
        className="pointer-events-none absolute bottom-[16%] left-[15%] hidden h-6 animate-float opacity-15 lg:block"
        style={{ animationDelay: '3s' }}
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        {/* 左侧文案 */}
        <div className="text-center lg:text-left">
          {/* 眉标胶囊 */}
          <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-4 py-1.5 text-sm font-medium text-muted-foreground shadow-card backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
            开源 · 自托管 · 多墙统一管理
          </span>

          <h1 className="mt-6 font-heading text-4xl font-bold leading-tight tracking-tight text-balance md:text-5xl lg:text-[3.4rem]">
            开源
            <span className="gradient-text">校园墙</span>
            运营系统
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg lg:mx-0">
            面向校园墙运营管理员的投稿、审核、Bot、QZone
            发布与运维一体化平台。一个实例，统一管理多个校园墙。
          </p>

          {/* 按钮 */}
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Button
              asChild
              className="group h-12 w-full rounded-full bg-primary px-7 text-base font-semibold shadow-lg shadow-primary/25 transition-transform hover:bg-primary/90 active:scale-95 sm:w-auto"
            >
              <a href={LINKS.docs.selfService} target="_blank" rel="noreferrer">
                自助开墙
                <ArrowRight
                  aria-hidden="true"
                  className="h-4.5 w-4.5 transition-transform duration-300 group-hover:translate-x-1"
                />
              </a>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="h-12 w-full rounded-full border border-border bg-card/70 px-7 text-base font-semibold text-foreground backdrop-blur transition-transform hover:bg-secondary active:scale-95 sm:w-auto"
            >
              <a href={LINKS.docs.quickstart} target="_blank" rel="noreferrer">
                部署快速开始
              </a>
            </Button>
          </div>

          {/* 数据亮点 */}
          <dl className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
            {HIGHLIGHTS.map(({ icon: Icon, label, text }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-card/70 px-3 py-4 text-center backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-card lg:items-start lg:px-4 lg:text-left"
              >
                <Icon aria-hidden="true" className="h-4.5 w-4.5 text-primary" />
                <dt className="font-heading text-base font-bold text-foreground md:text-lg">
                  {label}
                </dt>
                <dd className="text-xs text-muted-foreground md:text-sm">{text}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* 右侧：浏览器窗口风格截图 */}
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/15 via-transparent to-aqua/15 blur-xl"
          />
          <BrowserWindow
            title="campux · 稿件审核工作台"
            src={IMAGES.heroReview}
            alt="Campux 稿件审核工作台界面"
            aspectClassName="aspect-[16/11]"
            onImageClick={() => onImageClick(IMAGES.heroReview, 'campux · 稿件审核工作台')}
            className="relative rotate-[0.6deg] transition-transform duration-500 hover:rotate-0"
          />
        </div>
      </div>
    </section>
  );
}
