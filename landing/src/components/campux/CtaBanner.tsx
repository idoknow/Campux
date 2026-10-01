import { ArrowRight, Github, Sparkle, Sparkles } from 'lucide-react';
import { LINKS } from '@/lib/campux';
import { Button } from '@/components/ui/button';
import { Reveal } from './Reveal';

/** 底部 CTA 横幅：品牌渐变背景 + 柔光圆形装饰 + 星光点缀 */
export function CtaBanner() {
  return (
    <section className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-cta px-6 py-14 text-center shadow-2xl shadow-primary/30 md:px-12 md:py-20">
            {/* 柔光圆形装饰 */}
            <div
              aria-hidden="true"
              className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/15 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="absolute -bottom-24 -right-10 h-72 w-72 rounded-full bg-aqua/25 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-40 w-[130%] -translate-x-1/2 rounded-full bg-white/10 blur-3xl"
            />
            {/* 星光点缀 */}
            <Sparkle
              aria-hidden="true"
              className="absolute left-[10%] top-10 h-4 w-4 animate-pulse text-white/40"
            />
            <Sparkles
              aria-hidden="true"
              className="absolute right-[12%] top-16 h-5 w-5 animate-pulse text-white/50 [animation-delay:1.2s]"
            />
            <Sparkle
              aria-hidden="true"
              className="absolute bottom-12 left-[24%] h-3 w-3 animate-pulse text-white/30 [animation-delay:2.4s]"
            />
            <Sparkle
              aria-hidden="true"
              className="absolute bottom-16 right-[26%] h-4 w-4 animate-pulse text-white/35 [animation-delay:0.8s]"
            />

            <h2 className="relative font-heading text-3xl font-bold tracking-tight text-balance text-white md:text-4xl">
              给你的校园墙一套顺手的运营系统
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-white/85 md:text-lg">
              免费、开源、可自托管。几分钟即可自助开墙或部署你自己的实例。
            </p>

            <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                className="group h-12 w-full rounded-full bg-white px-8 text-base font-semibold text-brand-deep shadow-lg shadow-black/10 transition-transform hover:bg-white/90 active:scale-95 sm:w-auto"
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
                className="h-12 w-full rounded-full border border-white/60 px-8 text-base font-semibold text-white hover:bg-white/10 active:scale-95 sm:w-auto"
              >
                <a href={LINKS.github} target="_blank" rel="noreferrer">
                  <Github aria-hidden="true" className="h-4.5 w-4.5" />
                  在 GitHub 上查看源码
                </a>
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
