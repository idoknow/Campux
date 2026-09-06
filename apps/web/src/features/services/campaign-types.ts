export type CampaignStatus = "pending_approval" | "running" | "ended" | "rejected" | "taken_down";
export type CampaignFilter = "active" | "ending_soon" | "ended" | "pending";
export type CampaignAttachment = { key: string; url: string };
export type VoterEntry = {
  count: number;
  voter: { displayName: string | null; qqUin: string } | null;
};
export type CampaignOption = {
  id: string;
  label: string;
  voteTotal: number;
  rank: number;
  imageAttachment: CampaignAttachment | null;
  voters: VoterEntry[];
};
export type Campaign = {
  id: string;
  displayId: number;
  title: string;
  status: CampaignStatus;
  anonymous: boolean;
  votesPerPerson: number;
  allowStackOnOption: boolean;
  showVoterDetails: boolean;
  durationHours: number;
  startsAt: string | null;
  endsAt: string | null;
  rejectReason: string | null;
  takenDownAt: string | null;
  createdAt: string;
  coverAttachment: CampaignAttachment | null;
  options: CampaignOption[];
  author?: { displayName: string | null; qqUin: string } | null;
};
export type CampaignDetail = Campaign & {
  effectiveStatus: CampaignStatus;
  myVotedCount: number;
  canVote: boolean;
  canAddVote: boolean;
};
export type CampaignListResponse = {
  items: Campaign[];
  pagination: { page: number; limit: number; total: number };
};
export type StatusBadgeInfo = { text: string; className: string };
export function statusBadge(status: string): StatusBadgeInfo {
  switch (status) {
    case "running":
      return { text: "进行中", className: "bg-emerald-100 text-emerald-700" };
    case "pending_approval":
      return { text: "待审核", className: "bg-amber-100 text-amber-700" };
    case "ended":
      return { text: "已结束", className: "bg-slate-100 text-slate-500" };
    case "rejected":
      return { text: "已拒绝", className: "bg-rose-100 text-rose-700" };
    case "taken_down":
      return { text: "已下架", className: "bg-slate-200 text-slate-600" };
    default:
      return { text: status, className: "bg-slate-100 text-slate-500" };
  }
}
export function formatEndsAt(endsAt: string | null): string {
  if (!endsAt) return "—";
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return "已结束";
  const hours = Math.floor(diff / 3600_000);
  const days = Math.floor(hours / 24);
  const remainHours = hours - days * 24;
  if (days > 0) return `${days} 天后结束`;
  return `剩余 ${remainHours} 小时`;
}

export function formatDuration(hours: number): string {
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const rest = hours - days * 24;
  return rest > 0 ? `${days} 天 ${rest} 小时` : `${days} 天`;
}
