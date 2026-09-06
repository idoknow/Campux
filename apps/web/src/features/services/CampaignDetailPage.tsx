import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeftIcon } from "lucide-react";
import { api } from "@/lib/api";
import { canAccess } from "@/lib/app-model";
import type { AuthenticatedMe, TenantMetadata } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type Campaign,
  type CampaignDetail,
  type VoterEntry,
  formatEndsAt,
  formatDuration,
  statusBadge,
} from "./campaign-types";

export function CampaignDetailPage({
  campaignId,
  me,
  metadata,
  onBack,
}: {
  campaignId: string;
  me: AuthenticatedMe;
  metadata: TenantMetadata;
  onBack: () => void;
}) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [voteCount, setVoteCount] = useState(1);
  const [confirmVote, setConfirmVote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voterDialog, setVoterDialog] = useState<{ optionId: string; optionLabel: string; voters: VoterEntry[] } | null>(null);
  const canAdmin = me.currentMembership ? canAccess(me.currentMembership.role, "admin") : false;
  const canReview = me.currentMembership ? canAccess(me.currentMembership.role, "reviewer") : false;
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approveBusy, setApproveBusy] = useState(false);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [takedownBusy, setTakedownBusy] = useState(false);
  const [takedownOpen, setTakedownOpen] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load 是稳定的首次加载入口，仅依赖 campaignId
  }, [campaignId]);

  function load() {
    setLoading(true);
    void api<{ campaign: CampaignDetail }>(`/api/campaigns/${encodeURIComponent(campaignId)}`)
      .then((res) => {
        setCampaign(res.campaign);
        setNotFound(false);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }

  async function submitVote() {
    if (!campaign || !selectedOptionId) return;
    setBusy(true);
    try {
      await api(`/api/campaigns/${encodeURIComponent(campaignId)}/votes`, {
        method: "POST",
        body: JSON.stringify({ optionId: selectedOptionId, count: voteCount }),
      });
      toast.success("投票成功");
      setConfirmVote(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "投票失败");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!campaign) return;
    setApproveBusy(true);
    try {
      await api(`/api/campaigns/${encodeURIComponent(campaignId)}/approve`, { method: "POST" });
      toast.success("已通过竞选");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setApproveBusy(false);
    }
  }

  async function submitReject() {
    if (!campaign) return;
    if (rejectReason.trim().length === 0) {
      toast.error("必须填写拒绝理由");
      return;
    }
    setRejectBusy(true);
    try {
      await api(`/api/campaigns/${encodeURIComponent(campaignId)}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      toast.success("已拒绝竞选");
      setRejectOpen(false);
      setRejectReason("");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setRejectBusy(false);
    }
  }

  async function takedown() {
    if (!campaign) return;
    setTakedownBusy(true);
    try {
      await api(`/api/campaigns/${encodeURIComponent(campaignId)}/takedown`, { method: "POST" });
      toast.success("已下架竞选");
      setTakedownOpen(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setTakedownBusy(false);
    }
  }

  if (loading) return <section className="product-surface p-4 text-sm text-slate-500">正在加载…</section>;
  if (notFound) return <section className="product-surface p-4 text-sm text-slate-500">竞选不存在或已下架。</section>;
  if (!campaign) return null;

  const badge = statusBadge(campaign.effectiveStatus);
  const maxVote = Math.max(1, ...campaign.options.map((option) => option.voteTotal));
  const remainingVotes = campaign.votesPerPerson - campaign.myVotedCount;
  const selectedOption = campaign.options.find((option) => option.id === selectedOptionId) ?? null;
  const showReviewActions = campaign.effectiveStatus === "pending_approval" && canReview;
  const showVotePanel = campaign.effectiveStatus === "running" && campaign.canVote && remainingVotes > 0;
  return (
    <section className="flex h-full min-h-0 flex-col px-4 pt-4">
      <button className="mb-2 inline-flex w-fit items-center gap-1 text-xs text-slate-500" onClick={onBack}>
        <ChevronLeftIcon className="size-3.5" /> 返回竞选列表
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
        <div className="product-surface p-4">
          {campaign.coverAttachment ? <img src={campaign.coverAttachment.url} alt="" className="mb-3 h-40 w-full rounded object-cover" /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">#{campaign.displayId}</span>
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.text}</span>
            {campaign.anonymous ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">匿名</span> : null}
            {campaign.allowStackOnOption ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">可重复投同一选项</span> : null}
          </div>
          <h1 className="mt-1 text-base font-semibold text-slate-950">{campaign.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{formatDuration(campaign.durationHours)} · 每人 {campaign.votesPerPerson} 票{campaign.allowStackOnOption ? " · 同一选项可叠加" : " · 每选项限一票"} · {formatEndsAt(campaign.endsAt)}</p>
          {campaign.rejectReason ? <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">拒绝理由：{campaign.rejectReason}</p> : null}
          {campaign.takenDownAt ? <p className="mt-2 rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">已由管理员下架{campaign.takenDownAt ? `（${new Date(campaign.takenDownAt).toLocaleString()}）` : ""}</p> : null}
          {showReviewActions ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <span className="text-xs font-semibold text-amber-800">待审核</span>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={approveBusy || rejectBusy} onClick={() => void approve()}>
                {approveBusy ? "通过中..." : "通过"}
              </Button>
              <Button size="sm" variant="outline" className="border-rose-200 text-rose-600" disabled={approveBusy || rejectBusy} onClick={() => setRejectOpen(true)}>
                {rejectBusy ? "拒绝中..." : "拒绝"}
              </Button>
              <span className="text-xs text-amber-700">通过后立即开始计时并通知发起人。</span>
            </div>
          ) : null}
          {!showReviewActions && campaign.effectiveStatus === "running" && canAdmin ? (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="outline" className="border-rose-200 text-rose-600" onClick={() => setTakedownOpen(true)}>
                下架竞选
              </Button>
            </div>
          ) : null}
          {campaign.myVotedCount > 0 ? <p className="mt-2 text-xs text-emerald-600">你已投 {campaign.myVotedCount} 票{campaign.canVote ? `，还可投 ${remainingVotes} 票` : ""}</p> : null}
          {campaign.effectiveStatus === "running" && !campaign.canVote && campaign.myVotedCount > 0 ? <p className="mt-2 text-xs text-slate-500">你的票数已用完，感谢参与。</p> : null}
          <div className="mt-3 grid gap-2">
            {campaign.options.map((option, index) => {
              const percent = maxVote > 0 ? Math.round((option.voteTotal / maxVote) * 100) : 0;
              const selected = selectedOptionId === option.id;
              const selectable = showVotePanel;
              return (
                <div
                  key={option.id}
                  onClick={selectable ? () => setSelectedOptionId(selected ? null : option.id) : undefined}
                  className={`rounded-md border p-2 transition ${selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"} ${selectable ? "cursor-pointer hover:border-blue-300" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`grid size-6 shrink-0 place-items-center rounded text-xs font-bold text-white ${selected ? "bg-blue-600" : "bg-slate-900"}`}>{index + 1}</span>
                    {option.imageAttachment ? <img src={option.imageAttachment.url} alt="" className="size-8 shrink-0 rounded object-cover" /> : null}
                    <span className="flex-1 truncate text-sm font-medium text-slate-900">{option.label}</span>
                    <span className="text-sm font-semibold text-slate-900">{option.voteTotal} 票</span>
                    {selected ? <span className="rounded bg-blue-600 px-1.5 py-0.5 text-xs font-medium text-white">已选</span> : null}
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-slate-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
                  </div>
                  {campaign.showVoterDetails && option.voters.length > 0 ? (
                    <button
                      className="mt-1.5 text-xs text-blue-600"
                      onClick={(event) => { event.stopPropagation(); setVoterDialog({ optionId: option.id, optionLabel: option.label, voters: option.voters }); }}
                    >
                      查看投票明细
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {showVotePanel ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-sm font-semibold text-emerald-900">投出你的票{campaign.votesPerPerson > 1 ? `（还可投 ${remainingVotes} 票）` : ""}</p>
              {selectedOption ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-emerald-900">已选：{selectedOption.label}</span>
                  {campaign.allowStackOnOption && campaign.votesPerPerson > 1 ? (
                    <span className="inline-flex items-center gap-1 text-sm text-emerald-900">
                      张票：
                      <Input
                        type="number"
                        min={1}
                        max={Math.min(remainingVotes, campaign.votesPerPerson)}
                        value={voteCount}
                        className="h-8 w-20"
                        onChange={(event) => setVoteCount(Math.max(1, Math.min(Number(event.target.value) || 1, Math.min(remainingVotes, campaign.votesPerPerson))))}
                      />
                    </span>
                  ) : null}
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => setConfirmVote(true)}>
                    {busy ? "提交中..." : "投票"}
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-emerald-700">点选任意选项即可投票{campaign.votesPerPerson > 1 && !campaign.allowStackOnOption ? "，每个选项限投 1 票" : ""}。</p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={confirmVote && Boolean(selectedOption)} onOpenChange={(open) => !open && setConfirmVote(false)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>确认投票</DialogTitle>
            <DialogDescription>
              将 {voteCount} 票投给「{selectedOption?.label ?? ""}」。投票后不可修改、不可撤回。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmVote(false)}>取消</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => void submitVote()}>
              {busy ? "提交中..." : "确认投票"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voterDialog !== null} onOpenChange={(open) => !open && setVoterDialog(null)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>「{voterDialog?.optionLabel ?? ""}」的投票明细</DialogTitle>
            <DialogDescription>按票数从多到少排列。</DialogDescription>
          </DialogHeader>
          <div className="px-5">
            {voterDialog && voterDialog.voters.length > 0 ? (
              <div className="grid gap-1">
                {voterDialog.voters.map((entry, index) => (
                  <div key={index} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1.5 text-sm">
                    <span className="truncate text-slate-700">{entry.voter ? entry.voter.displayName || `QQ ${entry.voter.qqUin}` : "匿名"}</span>
                    <span className="font-semibold text-slate-900">{entry.count} 票</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-slate-500">还没有人投这个选项。</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={(open) => !open && setRejectOpen(false)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>拒绝竞选</DialogTitle>
            <DialogDescription>拒绝必须填写理由，发起人会收到拒绝原因。</DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <Textarea
              placeholder="填写拒绝理由..."
              value={rejectReason}
              rows={3}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={rejectBusy} onClick={() => setRejectOpen(false)}>取消</Button>
            <Button variant="destructive" disabled={rejectBusy} onClick={() => void submitReject()}>
              {rejectBusy ? "提交中..." : "确认拒绝"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={takedownOpen} onOpenChange={(open) => !open && setTakedownOpen(false)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>下架竞选</DialogTitle>
            <DialogDescription>下架后所有人无法再投票，发起人会收到下架通知。确定下架吗？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={takedownBusy} onClick={() => setTakedownOpen(false)}>取消</Button>
            <Button variant="destructive" disabled={takedownBusy} onClick={() => void takedown()}>
              {takedownBusy ? "下架中..." : "确认下架"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

