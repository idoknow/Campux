import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GraduationCapIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GraduationItem } from "./GraduationsPage";
import { initials, qqAvatar } from "./graduation-utils";
export type { GraduationItem };

/**
 * 毕业去向待审核队列数据源。
 * 审核可能在多个入口发生（网页、审核群），故定时轮询 + 窗口焦点回归重取，
 * 保证已审核的记录不再留在队列里。
 */
export function useGraduationReviewQueue(enabled: boolean) {
  const [items, setItems] = useState<GraduationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      setLoading(true);
      api<{ items: GraduationItem[] }>("/api/graduations/pending")
        .then((res) => { if (!cancelled) setItems(res.items); })
        .catch((error) => toast.error(error instanceof Error ? error.message : "加载失败"))
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    load();
    const timer = setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [enabled, reloadKey]);

  return { items, loading, reload: () => setReloadKey((n) => n + 1) };
}

export function GraduationCard({ item, onApprove, onReject }: {
  item: GraduationItem;
  onApprove?: (target: GraduationItem) => void;
  onReject?: (target: GraduationItem) => void;
}) {
  const showActions = Boolean(onApprove || onReject);
  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-200 hover:shadow-md">
      <div className="flex items-start gap-4">
        <Avatar className="size-11 shrink-0 ring-2 ring-violet-100 dark:ring-violet-500/30">
          <AvatarImage src={item.author?.qqUin ? qqAvatar(item.author.qqUin) : undefined} alt="" referrerPolicy="no-referrer" loading="lazy" />
          <AvatarFallback className="bg-gradient-to-br from-violet-100 to-fuchsia-100 font-semibold text-violet-700 dark:from-violet-800 dark:to-fuchsia-800 dark:text-violet-100">
            {initials(item.author?.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-950">{item.author?.displayName ?? "未命名用户"}</span>
            <span className="font-mono text-xs text-slate-500">{item.author?.qqUin ?? "—"}</span>
            <span className="text-[11px] text-slate-300">#{item.displayId}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5 text-xs text-slate-600 sm:grid-cols-4">
            <div>
              <span className="text-slate-400">届：</span>
              <span className="font-mono font-semibold text-slate-800">{item.graduationYear}</span>
            </div>
            <div>
              <span className="text-slate-400">级：</span>
              <span className="font-mono font-semibold text-slate-800">{item.classYear}</span>
            </div>
            <div>
              <span className="text-slate-400">学历：</span>
              <span className="rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700">{item.education}</span>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-violet-100 bg-violet-50/50 px-3.5 py-2.5 dark:border-violet-500/25 dark:bg-violet-500/10">
            <GraduationCapIcon className="mt-0.5 size-4 shrink-0 text-violet-500 dark:text-violet-300" />
            <span className="min-w-0 break-words text-sm font-medium leading-5 text-violet-950 dark:text-violet-100">{item.destination}</span>
          </div>
          {item.rejectReason ? <p className="mt-2.5 text-xs text-rose-600 dark:text-rose-300">驳回理由：{item.rejectReason}</p> : null}
        </div>
      </div>
      {showActions ? (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
          {onApprove ? (
            <Button size="sm" variant="outline" className="border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25" onClick={() => onApprove(item)}>
              允许毕业
            </Button>
          ) : null}
          {onReject ? (
            <Button size="sm" variant="outline" className="border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25" onClick={() => onReject(item)}>
              驳回
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 毕业去向待审核队列：迁移自毕业生去向页，现归属「稿件 - 审核稿件」。 */
export function GraduationPendingReview({ items, onApprove, onReject }: {
  items: GraduationItem[];
  onApprove: (target: GraduationItem) => void;
  onReject: (target: GraduationItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center dark:border-slate-700 dark:bg-white/5">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-violet-100 bg-violet-50/60 dark:border-violet-500/30 dark:bg-violet-500/10">
          <GraduationCapIcon className="size-8 text-violet-300 dark:text-violet-500/70" />
        </span>
        <p className="mt-3 text-sm font-medium text-slate-500">暂无待审核的毕业去向</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {items.map((item) => <GraduationCard key={item.id} item={item} onApprove={onApprove} onReject={onReject} />)}
    </div>
  );
}

export function GraduationRejectDialog({ target, onClose, onSubmit }: {
  target: GraduationItem | null;
  onClose: () => void;
  onSubmit: (target: GraduationItem, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason("");
  }, [target]);

  if (!target) return null;

  async function submit() {
    if (reason.trim().length === 0) {
      toast.error("必须填写驳回理由");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(target!, reason.trim());
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>驳回毕业去向 #{target.displayId}</DialogTitle>
          <DialogDescription>驳回必须填写理由，提交者会收到驳回通知。</DialogDescription>
        </DialogHeader>
        <div className="px-5">
          <Textarea
            placeholder="填写驳回理由..."
            value={reason}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {busy ? "提交中..." : "确认驳回"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

