import type { LucideIcon } from "lucide-react";
import { BarChart3Icon, ClipboardListIcon, HomeIcon, ShieldCheckIcon, SparklesIcon, WrenchIcon } from "lucide-react";
import type { MainTab, TenantMetadata, TenantRole } from "@/types/app";

export type NavItem = {
  value: MainTab;
  label: string;
  emoji: string;
  icon: LucideIcon;
  minRole: TenantRole;
  badge?: string;
};

export const defaultMetadata: TenantMetadata = {
  brand: "校园墙",
  banner: "",
  logoUrl: "",
  postRules: [
    "不发布隐私信息、辱骂、人身攻击和未经确认的指控。",
    "寻物招领请写清地点、时间和联系方式。",
    "图片最多 9 张，单张 ≤ 10MB；审核通过后会同步到本校启用的墙号。",
  ],
  pendingPostLimit: 1,
  services: [
    { title: "修改名称", description: "更新投稿时使用的显示名" },
    { title: "修改密码", description: "保护你的校园墙账号" },
    { title: "投稿规则", description: "查看本墙投稿规范" },
    { title: "校园服务", description: "常用校园入口" },
  ],
  imageCompression: {
    enabled: true,
    quality: 80,
    maxDimension: 2048,
  },
  botStylishMessagesEnabled: false,
};

export const navItems = [
  { value: "post", label: "投稿", emoji: "📝", icon: HomeIcon, minRole: "submitter" },
  { value: "posts", label: "稿件", emoji: "🌏", icon: ClipboardListIcon, minRole: "submitter" },
  { value: "services", label: "服务", emoji: "🛠", icon: WrenchIcon, minRole: "submitter" },
  { value: "ai", label: "AI 图谱", emoji: "AI", icon: SparklesIcon, minRole: "reviewer", badge: "实验" },
  { value: "admin", label: "管理", emoji: "🔐", icon: ShieldCheckIcon, minRole: "admin" },
  { value: "stats", label: "统计", emoji: "📊", icon: BarChart3Icon, minRole: "reviewer" },
] satisfies NavItem[];

const roleRank: Record<TenantRole, number> = {
  submitter: 1,
  reviewer: 2,
  admin: 3,
};

export const roleLabels: Record<TenantRole, string> = {
  submitter: "用户",
  reviewer: "审核员",
  admin: "管理员",
};

export const statusLabels: Record<string, string> = {
  pending_approval: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  cancelled: "已取消",
  publishing: "发布中",
  partially_failed: "部分失败",
  failed: "发布失败",
  waiting_cookies: "等待登录态",
  published: "已发布",
  pending_recall: "待撤回",
  recalled: "已撤回",
};

export function canAccess(role: TenantRole, minRole: TenantRole) {
  return roleRank[role] >= roleRank[minRole];
}
