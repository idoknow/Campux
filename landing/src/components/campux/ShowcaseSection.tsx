import { IMAGES } from '@/lib/campux';
import { Reveal } from './Reveal';
import { SectionHeading } from './WhySection';
import { BrowserWindow } from './BrowserWindow';

/** 画廊条目说明文案 */
const CAPTIONS = {
  dashboard: '投稿量、访客量等运营数据图表，支持多时间范围切换。',
  review: '网页端稿件审核，支持通过、驳回与评论回流展示。',
  ops: '实例运行状态、资源占用与租户运维统一管理。',
} as const;

interface ShowcaseSectionProps {
  onImageClick: (src: string, title: string) => void;
}

/** 产品界面画廊：统计看板宽幅大图 + 审核工作台 + 运维面板，点击可全屏放大 */
export function ShowcaseSection({ onImageClick }: ShowcaseSectionProps) {
  return (
    <section id="showcase" className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <Reveal>
          <SectionHeading
            eyebrow="产品界面"
            title="真实的产品工作台"
            subtitle="核心工作台由投稿、稿件审核、租户管理、机器人、发布目标和统计看板组成。以下页面均来自实际产品界面。"
          />
        </Reveal>

        {/* 统计看板：宽幅大图 */}
        <Reveal className="mb-10 md:mb-12">
          <figure className="relative m-0">
            <div
              aria-hidden="true"
              className="absolute -inset-3 rounded-3xl bg-primary/10 blur-2xl"
            />
            <BrowserWindow
              title="campux · 统计看板"
              src={IMAGES.showcaseDashboard}
              alt="Campux 统计看板：投稿量与访客量图表"
              aspectClassName="aspect-[16/9] md:aspect-[21/10]"
              onImageClick={() => onImageClick(IMAGES.showcaseDashboard, 'campux · 统计看板')}
              className="relative"
            />
            <figcaption className="relative mt-4 flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1 text-center">
              <span className="font-heading text-base font-bold text-foreground">统计看板</span>
              <span className="text-sm text-muted-foreground">{CAPTIONS.dashboard}</span>
            </figcaption>
          </figure>
        </Reveal>

        {/* 审核工作台 + 运维面板 */}
        <div className="grid gap-10 md:grid-cols-2 md:gap-10">
          <Reveal delay={80}>
            <figure className="relative m-0 h-full">
              <div
                aria-hidden="true"
                className="absolute -inset-3 rounded-3xl bg-aqua/10 blur-2xl"
              />
              <BrowserWindow
                title="campux · 稿件审核工作台"
                src={IMAGES.showcaseReview}
                alt="Campux 稿件审核工作台界面"
                aspectClassName="aspect-[16/11]"
                onImageClick={() =>
                  onImageClick(IMAGES.showcaseReview, 'campux · 稿件审核工作台')
                }
                className="relative"
              />
              <figcaption className="relative mt-4 flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1 text-center">
                <span className="font-heading text-base font-bold text-foreground">
                  稿件审核工作台
                </span>
                <span className="text-sm text-muted-foreground">{CAPTIONS.review}</span>
              </figcaption>
            </figure>
          </Reveal>
          <Reveal delay={160}>
            <figure className="relative m-0 h-full">
              <div
                aria-hidden="true"
                className="absolute -inset-3 rounded-3xl bg-lilac/10 blur-2xl"
              />
              <BrowserWindow
                title="campux · 系统运维面板"
                src={IMAGES.showcaseOps}
                alt="Campux 系统运维面板界面"
                aspectClassName="aspect-[16/11]"
                onImageClick={() => onImageClick(IMAGES.showcaseOps, 'campux · 系统运维面板')}
                className="relative"
              />
              <figcaption className="relative mt-4 flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1 text-center">
                <span className="font-heading text-base font-bold text-foreground">
                  系统运维面板
                </span>
                <span className="text-sm text-muted-foreground">{CAPTIONS.ops}</span>
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
