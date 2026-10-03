import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, MessageCircleQuestion, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QQ_GROUPS, TELEGRAM_GROUPS } from '@/lib/campux';
import { Reveal } from './Reveal';
import { SectionHeading } from './WhySection';

type QQGroup = (typeof QQ_GROUPS)[number];
type TelegramGroup = (typeof TELEGRAM_GROUPS)[number];

/** 复制成功状态的展示时长（ms） */
const COPY_RESET_MS = 2000;

/** 复制文本到剪贴板，剪贴板 API 不可用时回退到 execCommand */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
    } catch {
      // 回退也失败时静默处理，仅不显示成功态
    }
    document.body.removeChild(el);
  }
}

interface QQGroupCardProps {
  group: QQGroup;
}

/** 单个 QQ 群卡片：主体点击跳转加群，群号行支持一键复制 */
function QQGroupCard({ group }: QQGroupCardProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = async () => {
    await copyText(group.number);
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
  };

  return (
    <article className="group flex h-full flex-col rounded-3xl border border-border/70 bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-hover md:p-7">
      <a href={group.href} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-5">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-chart-1 to-chart-3 font-heading text-base font-bold text-primary-foreground shadow-md shadow-primary/25 ring-2 ring-white/25 transition-shadow duration-300 group-hover:shadow-lg group-hover:shadow-primary/40"
        >
          QQ
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-lg font-bold text-foreground">{group.name}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{group.description}</span>
        </span>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-all duration-300 group-hover:border-primary/40 group-hover:text-primary">
          <ArrowRight aria-hidden="true" className="h-4.5 w-4.5 transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </a>
      <div className="mt-4 flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
          群号 {group.number}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? '群号已复制' : `复制群号 ${group.number}`}
          className={cn(
            'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background transition-all duration-300 after:absolute after:-inset-2 after:content-[""]',
            copied ? 'border-mint/50 bg-mint/10 text-mint' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary active:scale-90'
          )}
        >
          {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
        </button>
        <span aria-live="polite" className={cn('text-xs font-medium text-mint transition-all duration-300', copied ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0')}>
          已复制
        </span>
      </div>
    </article>
  );
}

interface TelegramGroupCardProps {
  group: TelegramGroup;
}

/** 单个 Telegram 群卡片：点击直接进入邀请链接 */
function TelegramGroupCard({ group }: TelegramGroupCardProps) {
  return (
    <article className="group flex h-full flex-col rounded-3xl border border-border/70 bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-hover md:p-7">
      <a href={group.href} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-5">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-md shadow-sky-500/25 ring-2 ring-white/25 transition-shadow duration-300 group-hover:shadow-lg group-hover:shadow-sky-500/40"
        >
          <Send aria-hidden="true" className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-lg font-bold text-foreground">{group.name}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{group.description}</span>
        </span>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-all duration-300 group-hover:border-primary/40 group-hover:text-primary">
          <ArrowRight aria-hidden="true" className="h-4.5 w-4.5 transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </a>
      <div className="mt-4 flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          t.me 邀请链接
        </span>
      </div>
    </article>
  );
}

/** 社区：官方 QQ 交流群 + Telegram 交流群 */
export function CommunitySection() {
  return (
    <section id="community" className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <Reveal>
          <SectionHeading
            eyebrow="社区"
            title="加入交流群"
            subtitle="使用或部署中遇到问题，欢迎加入官方 QQ 或 Telegram 交流群，与其他墙运营者一起讨论。"
          />
        </Reveal>

        <div className="grid gap-5 md:grid-cols-3 md:gap-6">
          {QQ_GROUPS.map((group, index) => (
            <Reveal key={group.number} delay={index * 100}>
              <QQGroupCard group={group} />
            </Reveal>
          ))}
          {TELEGRAM_GROUPS.map((group, index) => (
            <Reveal key={group.href} delay={(QQ_GROUPS.length + index) * 100}>
              <TelegramGroupCard group={group} />
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <p className="mt-8 flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <MessageCircleQuestion aria-hidden="true" className="h-4 w-4 shrink-0" />
            点击卡片跳转加群；QQ 群支持复制群号，装有 QQ 客户端的设备可直接打开加群卡片。
          </p>
        </Reveal>
      </div>
    </section>
  );
}
