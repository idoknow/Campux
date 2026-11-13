import { useState } from "react";
import { CheckCircle2Icon, CopyIcon, ExternalLinkIcon, LoaderIcon, MessageSquarePlusIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { CAMPUX_USER_GROUP } from "@/lib/campux-community";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const MAX_FEEDBACK_LENGTH = 1000;

/**
 * 租户管理页顶部的「意见反馈」横条：租户管理员向 Campux 开发/运维提意见。
 * 意见会进入平台侧意见箱（只有系统运维能在运维面板查看），提交后引导加入用户组跟进。
 */
export function PlatformFeedbackBanner({ tenantName }: { tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  function changeOpen(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setSubmittedId(null);
      setContent("");
    }
  }

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; id: string }>("/api/platform-feedback", {
        method: "POST",
        body: JSON.stringify({ content: trimmed }),
      });
      setSubmittedId(result.id);
      setContent("");
      toast.success("已反馈给 Campux 开发/运维");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "反馈提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function copyGroupNumber() {
    try {
      await navigator.clipboard.writeText(CAMPUX_USER_GROUP.number);
      toast.success(`已复制群号：${CAMPUX_USER_GROUP.number}`);
    } catch {
      toast.error("复制失败，请手动记录群号。");
    }
  }

  return (
    <>
      {/* 整条都是入口：只说明「问题/建议 → 反馈给开发/运维」，加群等细节留到提交成功后再讲。 */}
      <button
        type="button"
        className="mb-3 flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-sky-100 bg-sky-50/70 px-3 py-2 text-left transition-colors hover:border-sky-200 hover:bg-sky-50 focus-visible:border-sky-300 focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:outline-none"
        onClick={() => setOpen(true)}
      >
        <MessageSquarePlusIcon className="size-4 shrink-0 text-sky-600" aria-hidden />
        <span className="min-w-0 flex-1 text-sm leading-5 text-slate-600">
          <span className="font-bold text-slate-900">想加功能 / 遇到 bug？</span>
          <span>告诉我们，</span>
          <span className="font-medium text-sky-700">直接反馈给 Campux 开发/运维</span>
        </span>
        <span
          aria-hidden
          className="inline-flex h-7 shrink-0 items-center rounded-[min(var(--radius-md),12px)] border border-slate-200 bg-white px-2.5 text-[0.8rem] font-medium text-slate-900"
        >
          提交反馈
        </span>
      </button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{submittedId ? "反馈已提交" : "反馈给 Campux 开发/运维"}</DialogTitle>
            <DialogDescription>
              {submittedId
                ? "开发/运维会在运维面板看到这条反馈。"
                : `当前校园墙：${tenantName}。bug、功能建议、体验问题都可以写在这里。`}
            </DialogDescription>
          </DialogHeader>

          {submittedId ? (
            <div className="grid gap-3 px-5 pb-5">
              <div className="flex items-start gap-2 rounded-md border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-800">
                <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p className="leading-5">
                  处理进度会在 <span className="font-bold">{CAMPUX_USER_GROUP.name}</span>同步，欢迎加入（群号{" "}
                  <span className="font-mono font-bold">{CAMPUX_USER_GROUP.number}</span>）。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyGroupNumber()}>
                  <CopyIcon data-icon="inline-start" />
                  复制群号
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={CAMPUX_USER_GROUP.href} target="_blank" rel="noreferrer">
                    <ExternalLinkIcon data-icon="inline-start" />
                    打开加群链接
                  </a>
                </Button>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => changeOpen(false)}>
                  完成
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 px-5 pb-5">
              <Textarea
                value={content}
                maxLength={MAX_FEEDBACK_LENGTH}
                rows={5}
                placeholder="例如：希望审核队列支持按标签批量操作；或者某个功能用起来不顺的地方…"
                disabled={busy}
                onChange={(event) => setContent(event.target.value)}
              />
              <p className="text-right text-xs text-slate-400">
                {content.length}/{MAX_FEEDBACK_LENGTH}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => changeOpen(false)}>
                  取消
                </Button>
                <Button size="sm" disabled={busy || content.trim().length === 0} onClick={() => void submit()}>
                  {busy ? <LoaderIcon className="animate-spin" data-icon="inline-start" /> : null}
                  提交反馈
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
