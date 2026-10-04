import { useEffect, useState } from "react";
import { ChevronLeftIcon, CalendarIcon, HeartIcon, SparklesIcon, UsersIcon, CalendarDaysIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Live2DPuppy } from "@/features/live2d/Live2DPuppy";
import { api } from "@/lib/api";

type LinglingData = {
  name: string;
  birthday: string;
  species: string;
  gender: string;
  intro: string;
  growthValue: number;
  breakdown: {
    posts: number;
    comments: number;
    visitors: number;
    forwards: number;
    likes: number;
    users: number;
    runDays: number;
  };
};

export function LinglingPage({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<LinglingData | null>(null);

  useEffect(() => {
    void api<LinglingData>("/api/services/lingling")
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pt-4">
      <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="返回服务" onClick={onBack}>
            <ChevronLeftIcon />
          </Button>
          <h1 className="text-base font-bold text-foreground">吉祥萌宠</h1>
        </div>

        <section className="product-surface overflow-hidden">
          <div className="relative px-4 pb-5 pt-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-rose-50 to-transparent" />
            <div className="relative mx-auto w-[280px]">
              <Live2DPuppy className="mx-auto" width={280} height={320} zoom={1.08} />
            </div>
          </div>
        </section>

        {data ? (
          <div className="mt-3 space-y-3">
            <section className="product-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">宠物名称</p>
                  <p className="mt-1 text-xl font-black tracking-tight text-foreground">{data.name}</p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">{data.intro}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 ring-1 ring-emerald-500/25">
                  <SparklesIcon className="size-3.5" />
                  成长值 {data.growthValue.toFixed(2)}
                </span>
              </div>
            </section>

            <section className="product-surface grid gap-3 p-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <CalendarIcon className="size-3.5" />
                  生日
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{data.birthday}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <UsersIcon className="size-3.5" />
                  物种
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{data.species}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <HeartIcon className="size-3.5" />
                  性别
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{data.gender}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <CalendarDaysIcon className="size-3.5" />
                  成长值
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">{data.growthValue.toFixed(2)}</p>
              </div>
            </section>
          </div>
        ) : (

          <section className="product-surface mt-3 p-4 text-sm text-muted-foreground">正在读取吉祥萌宠信息...</section>
        )}
      </div>
    </div>
  );
}
