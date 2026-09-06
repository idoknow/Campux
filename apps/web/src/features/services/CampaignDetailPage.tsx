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
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approveBusy, setApproveBusy] = useState(false);
  const [rejectBusy, setRejectBusy] = useState(false);

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
    setBusy(true);
    try {
      await api(`/api/campaigns/${encodeURIComponent(campaignId)}/takedown`, { method: "POST" });
      toast.success("已下架竞选");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="product-surface p-4 text-sm text-slate-500">正在加载…</section>;
  if (notFound) return <section className="product-surface p-4 text-sm text-slate-500">竞选不存在或已下架。</section>;
  if (!campaign) return null;

  const badge = statusBadge(campaign.effectiveStatus);
  const maxVote = Math.max(1, ...campaign.options.map((option) => option.voteTotal));
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
            {campaign.allowStackOnOption ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">可同选</span> : null}
          </div>
          <h1 className="mt-1 text-base font-semibold text-slate-950">{campaign.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{formatDuration(campaign.durationHours)} · 每人 {campaign.votesPerPerson} 票 · {formatEndsAt(campaign.endsAt)}</p>
          {campaign.rejectReason ? <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-600">拒绝理由：{campaign.rejectReason}</p> : null}
          {campaign.canVote ? null : campaign.myVotedCount > 0 ? <p className="mt-2 text-xs text-emerald-600">你已投 {campaign.myVotedCount} 票</p> : null}
          <div className="mt-3 grid gap-2">
            {campaign.options.map((option, index) => {
              const percent = maxVote > 0 ? Math.round((option.voteTotal / maxVote) * 100) : 0;
              const selected = selectedOptionId === option.id;
              return (
                <div key={option.id} className={`rounded-md border p-2 ${selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded bg-slate-900 text-xs font-bold text-white">{index + 1}</span>
                    {option.imageAttachment ? <img src={option.imageAttachment.url} alt="" className="size-8 shrink-0 rounded object-cover" /> : null}
                    <span className="flex-1 truncate text-sm font-medium text-slate-900">{option.label}</span>
                    <span className="text-sm font-semibold text-slate-900">{option.voteTotal}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-slate-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
                  </div>
                  {campaign.showVoterDetails && option.voters.length > 0 ? (
                    <button className="mt-1.5 text-xs text-blue-600" onClick={() => setVoterDialog({ optionId: option.id, optionLabel: option.label, voters: option.voters })}>
                      查看投票明细
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

