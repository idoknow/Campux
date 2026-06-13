import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircleIcon,
  BellIcon,
  BellRingIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  HashIcon,
  HeartIcon,
  ImageIcon,
  MessageCircleIcon,
  ChevronDownIcon,
  RotateCcwIcon,
  SearchIcon,
  Share2Icon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import type { Pagination, PostItem, PostsTab, PostTimelineEntry, PublishedFeedItem, ReviewPostItem, TenantRole } from "@/types/app";
import { canAccess, statusLabels } from "@/lib/app-model";
import { readListPreferences, writeListPreferences } from "@/lib/list-preferences";
import { hasAnyQueryParam, readQueryInt, readQueryParam, writeQueryParams } from "@/lib/url-query";
import { EmptyCard, LoadingBlock, PaginationControls } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type PostImage = {
  kind?: "image";
  key?: string;
  url?: string;
  fileName?: string;
  contentType?: string;
};

type RenderPreviewState = {
  open: boolean;
  loading: boolean;
  error: string;
  url: string;
  title: string;
};

type RejectDialogState = {
  open: boolean;
  postId: string;
  displayId: number | null;
  reason: string;
};

type RecallConfirmState =
  | {
      open: false;
      mode: null;
      post: null;
    }
  | {
      open: true;
      mode: "request";
      post: PostItem;
    }
  | {
      open: true;
      mode: "approve" | "reject" | "admin" | "admin-silent";
      post: ReviewPostItem;
    };

type ImagePreviewState = {
  open: boolean;
  images: PostImage[];
  index: number;
  title: string;
};

// 让深层嵌套的评论配图也能复用顶层看图浮窗，避免逐层透传回调
type ImageLightbox = (images: PostImage[], index: number, title: string) => void;
const ImageLightboxContext = createContext<ImageLightbox | null>(null);

const MarkdownContext = createContext(false);

function useImageLightbox(): ImageLightbox {
  const open = useContext(ImageLightboxContext);
  return open ?? (() => undefined);
}

const postCardPalettes = [
  "border-slate-200 bg-white",
  "border-slate-200 bg-white",
  "border-slate-200 bg-white",
  "border-slate-200 bg-white",
];
const defaultPostCardPalette = "border-slate-200 bg-white";

// ── 颜色映射（与 packages/render 同步） ────────────────

const BG_CARD_STYLE_MAP: Record<string, string> = {
  white:   "",
  pink:    "background: linear-gradient(135deg, #fff5f7 0%, #ffe4e8 50%, #ffdde6 100%)",
  blue:    "background: linear-gradient(135deg, #f0f7ff 0%, #dceeff 50%, #d0e8ff 100%)",
  green:   "background: linear-gradient(135deg, #f0faf0 0%, #dcf5dc 50%, #d0f0d0 100%)",
  yellow:  "background: linear-gradient(135deg, #fffff0 0%, #fffce0 50%, #fff9d0 100%)",
  orange:  "background: linear-gradient(135deg, #fff8f0 0%, #ffedd5 50%, #ffe5c0 100%)",
  purple:  "background: linear-gradient(135deg, #f8f0ff 0%, #ede0ff 50%, #e5d5ff 100%)",
};

const TEXT_CARD_COLOR_MAP: Record<string, string> = {
  black:       "",
  dark_red:    "#8B0000",
  dark_blue:   "#00008B",
  dark_green:  "#006400",
  dark_pink:   "#C71585",
  dark_purple: "#4B0082",
  dark_orange: "#CC5500",
};

function postCardBgStyle(bgColor: string | null): string | undefined {
  if (!bgColor) return undefined;
  return BG_CARD_STYLE_MAP[bgColor] ?? undefined;
}

function postCardTextColor(textColor: string | null): string | undefined {
  if (!textColor) return undefined;
  return TEXT_CARD_COLOR_MAP[textColor] ?? undefined;
}

const statusStyles: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  approved: "bg-green-100 text-green-900 ring-1 ring-green-300",
  rejected: "bg-red-100 text-red-800 ring-1 ring-red-300",
  cancelled: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-300",
  publishing: "bg-blue-100 text-blue-900 ring-1 ring-blue-300",
  waiting_batch: "bg-cyan-100 text-cyan-900 ring-1 ring-cyan-300",
  partially_failed: "bg-orange-100 text-orange-900 ring-1 ring-orange-300",
  failed: "bg-red-100 text-red-800 ring-1 ring-red-300",
  waiting_cookies: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  published: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400",
  pending_recall: "bg-violet-100 text-violet-900 ring-1 ring-violet-300",
  recalled: "bg-zinc-200 text-zinc-700 ring-1 ring-zinc-300",
};

const statusDotStyles: Record<string, string> = {
  pending_approval: "bg-amber-500",
  approved: "bg-green-500",
  rejected: "bg-red-500",
  cancelled: "bg-zinc-400",
  publishing: "bg-blue-500 animate-pulse",
  waiting_batch: "bg-cyan-500",
  partially_failed: "bg-orange-500",
  failed: "bg-red-500",
  waiting_cookies: "bg-amber-500 animate-pulse",
  published: "bg-emerald-500",
  pending_recall: "bg-violet-500 animate-pulse",
  recalled: "bg-zinc-400",
};

// 批量收集中的稿件后端复用 publishing 状态，前端派生为"等待批次"以区别于真正发布中。
const WAITING_BATCH_STATUS = "waiting_batch";
const waitingBatchLabel = "等待批次";

function displayStatusLabel(status: string): string {
  return status === WAITING_BATCH_STATUS ? waitingBatchLabel : statusLabels[status] ?? status;
}

const postTabsListClassName = "product-tabs-list";
const postTabsTriggerClassName = "product-tabs-trigger after:hidden";
const reviewStatusOptions = [
  { value: "pending_approval", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
  { value: "publishing", label: "发布中" },
  { value: "published", label: "已发布" },
  { value: "pending_recall", label: "待撤回" },
  { value: "pending_recall_ignored", label: "已忽略撤回" },
  { value: "recalled", label: "已撤回" },
  { value: "failed", label: "发布失败" },
  { value: "all", label: "全部" },
] as const;

type ReviewStatusFilter = (typeof reviewStatusOptions)[number]["value"];
type ReviewListPreferences = {
  status: ReviewStatusFilter;
  keyword: string;
};

const defaultReviewListPreferences: ReviewListPreferences = {
  status: "pending_approval",
  keyword: "",
};

function readReviewStatusQuery(): ReviewStatusFilter {
  const status = readQueryParam("status");
  return reviewStatusOptions.some((option) => option.value === status) ? (status as ReviewStatusFilter) : "pending_approval";
}

function reviewPreferencesKey(tenantId: string) {
  return `tenant.${tenantId}.posts.review`;
}

function isReviewListPreferences(value: unknown): value is ReviewListPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReviewListPreferences>;
  return typeof candidate.keyword === "string" && reviewStatusOptions.some((option) => option.value === candidate.status);
}

function readReviewListPreferences(tenantId: string): ReviewListPreferences {
  if (hasAnyQueryParam(["status", "q", "page", "post"])) {
    return {
      status: readReviewStatusQuery(),
      keyword: readQueryParam("q"),
    };
  }
  return readListPreferences(reviewPreferencesKey(tenantId), defaultReviewListPreferences, isReviewListPreferences);
}

function writeReviewListPreferences(tenantId: string, preferences: ReviewListPreferences) {
  writeListPreferences(reviewPreferencesKey(tenantId), preferences);
}

export function PostsPage({
  tenantId,
  posts,
  currentRole,
  activeTab,
  minePagination,
  mineLoading,
  autoFollowOwnPosts,
  enableMarkdownRender,
  onMinePageChange,
  onTabChange,
  onRefresh,
  onRefreshMe,
}: {
  tenantId: string;
  posts: PostItem[];
  currentRole: TenantRole;
  activeTab: PostsTab;
  minePagination: Pagination;
  mineLoading: boolean;
  autoFollowOwnPosts: boolean;
  enableMarkdownRender?: boolean;
  onMinePageChange: (page: number) => void;
  onTabChange: (tab: PostsTab) => void;
  onRefresh: () => Promise<void>;
  onRefreshMe: () => Promise<void>;
}) {
  const canReview = canAccess(currentRole, "reviewer");
  const isAdmin = canAccess(currentRole, "admin");
  const [pendingRecallPosts, setPendingRecallPosts] = useState<ReviewPostItem[]>([]);
  const [reviewPosts, setReviewPosts] = useState<ReviewPostItem[]>([]);
  const [reviewPagination, setReviewPagination] = useState<Pagination>(() => defaultPagination());
  const [reviewLoading, setReviewLoading] = useState(false);
  const [pendingRecallLoading, setPendingRecallLoading] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatusFilter>(() => readReviewListPreferences(tenantId).status);
  const [reviewKeyword, setReviewKeyword] = useState(() => readReviewListPreferences(tenantId).keyword);
  const [reviewPage, setReviewPage] = useState(() => readQueryInt("page", 1, { min: 1 }));
  const [publishedItems, setPublishedItems] = useState<PublishedFeedItem[]>([]);
  const [publishedPagination, setPublishedPagination] = useState<Pagination>(() => defaultPagination());
  const [publishedLoading, setPublishedLoading] = useState(false);
  const [publishedPage, setPublishedPage] = useState(1);
  const [detailPostId, setDetailPostId] = useState(() => readQueryParam("post"));
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [busyPostId, setBusyPostId] = useState("");
  const [busyCancelPostId, setBusyCancelPostId] = useState("");
  const [busyRecallPostId, setBusyRecallPostId] = useState("");
  const [busyFollowPostId, setBusyFollowPostId] = useState("");
  const [autoFollowBusy, setAutoFollowBusy] = useState(false);
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [approveAllBusy, setApproveAllBusy] = useState(false);
  const [rejectDialog, setRejectDialog] = useState<RejectDialogState>(() => ({
    open: false,
    postId: "",
    displayId: null,
    reason: "",
  }));
  const [recallConfirm, setRecallConfirm] = useState<RecallConfirmState>(() => ({
    open: false,
    mode: null,
    post: null,
  }));
  const [recallReason, setRecallReason] = useState("");
  const [preview, setPreview] = useState<RenderPreviewState>(() => ({
    open: false,
    loading: false,
    error: "",
    url: "",
    title: "",
  }));
  const [imagePreview, setImagePreview] = useState<ImagePreviewState>(() => ({
    open: false,
    images: [],
    index: 0,
    title: "",
  }));

  useEffect(() => {
    return () => {
      if (preview.url) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [preview.url]);

  useEffect(() => {
    if (!canReview && activeTab !== "mine" && activeTab !== "published") {
      onTabChange("mine");
    }
  }, [activeTab, canReview, onTabChange]);

  useEffect(() => {
    if (activeTab !== "review") {
      return;
    }
    const preferences = readReviewListPreferences(tenantId);
    setReviewStatus(preferences.status);
    setReviewKeyword(preferences.keyword);
    setReviewPage(readQueryInt("page", 1, { min: 1 }));
    setDetailPostId(readQueryParam("post"));
  }, [activeTab, tenantId]);

  useEffect(() => {
    if (!canReview) {
      setPendingRecallPosts([]);
      setReviewPosts([]);
      return;
    }

    setReviewPosts([]);
    void Promise.all([refreshPendingRecallPosts(), refreshReviewPosts(reviewPage)]).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取审核列表");
    });
  }, [canReview, reviewStatus, reviewPage, tenantId]);

  useEffect(() => {
    if (activeTab !== "published") {
      return;
    }
    void refreshPublishedFeed(publishedPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取已发布稿件");
    });
  }, [activeTab, publishedPage, tenantId]);

  async function refreshAll() {
    await onRefresh();
    if (canReview) {
      await Promise.all([refreshPendingRecallPosts(), refreshReviewPosts(reviewPage)]);
    }
    if (activeTab === "published") {
      await refreshPublishedFeed(publishedPage);
    }
  }

  async function refreshPendingRecallPosts() {
    const params = new URLSearchParams({
      status: "pending_recall",
      page: "1",
      limit: "50",
    });
    setPendingRecallLoading(true);
    try {
      const data = await api<{ posts: ReviewPostItem[]; pagination: Pagination }>(`/api/review/posts?${params}`);
      setPendingRecallPosts(data.posts);
    } finally {
      setPendingRecallLoading(false);
    }
  }

  async function refreshReviewPosts(page = reviewPage) {
    const params = new URLSearchParams({
      status: reviewStatus,
      page: String(page),
      limit: String(reviewPagination.limit),
    });
    const keyword = reviewKeyword.trim();
    if (keyword.length > 0) {
      params.set("q", keyword);
    }
    setReviewLoading(true);
    try {
      const data = await api<{ posts: ReviewPostItem[]; pagination: Pagination }>(`/api/review/posts?${params}`);
      setReviewPosts(data.posts);
      setReviewPagination(data.pagination);
    } finally {
      setReviewLoading(false);
    }
  }

  async function refreshPublishedFeed(page = publishedPage) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(publishedPagination.limit),
    });
    setPublishedLoading(true);
    try {
      const data = await api<{ items: PublishedFeedItem[]; pagination: Pagination }>(`/api/posts/published?${params}`);
      setPublishedItems(data.items);
      setPublishedPagination(data.pagination);
    } finally {
      setPublishedLoading(false);
    }
  }

  async function reviewPost(id: string, action: "approve" | "reject", comment?: string) {
    setBusyPostId(id);
    try {
      await api(`/api/review/posts/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify(comment ? { comment } : {}),
      });
      toast.success(action === "approve" ? "已通过，正在生成发布任务。" : "已拒绝。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "审核失败");
    } finally {
      setBusyPostId("");
    }
  }

  async function approveAllPosts() {
    setApproveAllBusy(true);
    try {
      const data = await api<{ ok: boolean; approved: number }>("/api/review/posts/approve-all", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success(data.approved > 0 ? `已通过 ${data.approved} 条稿件，正在生成发布任务。` : "当前没有待审核稿件。");
      setApproveAllOpen(false);
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "一键通过失败");
    } finally {
      setApproveAllBusy(false);
    }
  }

  async function cancelPost(id: string) {
    setBusyCancelPostId(id);
    try {
      await api(`/api/posts/${id}/cancel`, {
        method: "POST",
      });
      toast.success("稿件已取消。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "取消失败");
    } finally {
      setBusyCancelPostId("");
    }
  }

  async function toggleFollowPost(post: PostItem) {
    const next = !post.following;
    setBusyFollowPostId(post.id);
    try {
      await api(`/api/posts/${post.id}/follow`, {
        method: next ? "POST" : "DELETE",
      });
      toast.success(next ? "已关注，有新评论会每 12 小时私信提醒你。" : "已取消关注。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setBusyFollowPostId("");
    }
  }

  async function setAutoFollowOwnPosts(enabled: boolean) {
    setAutoFollowBusy(true);
    try {
      await api("/api/me/settings", {
        method: "PATCH",
        body: JSON.stringify({ autoFollowOwnPosts: enabled }),
      });
      toast.success(enabled ? "已开启：新稿件发出后会自动关注评论。" : "已关闭自动关注。");
      await onRefreshMe();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "设置失败");
    } finally {
      setAutoFollowBusy(false);
    }
  }

  async function requestRecallPost(post: PostItem, reason: string) {
    setBusyRecallPostId(post.id);
    try {
      await api(`/api/posts/${post.id}/recall/request`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      toast.success("已提交撤回申请，等待审核处理。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "申请撤回失败");
    } finally {
      setBusyRecallPostId("");
    }
  }

  async function approveRecallPost(post: ReviewPostItem) {
    setBusyPostId(post.id);
    try {
      await api(`/api/review/posts/${post.id}/recall/approve`, {
        method: "POST",
      });
      toast.success("已执行撤回。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "撤回失败");
      await refreshAll();
    } finally {
      setBusyPostId("");
    }
  }

  async function rejectRecallPost(post: ReviewPostItem) {
    setBusyPostId(post.id);
    try {
      await api(`/api/review/posts/${post.id}/recall/reject`, {
        method: "POST",
      });
      toast.success("已拒绝撤回申请，稿件恢复为已发表。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "拒绝撤回失败");
      await refreshAll();
    } finally {
      setBusyPostId("");
    }
  }

  async function ignoreRecallPost(post: ReviewPostItem) {
    setBusyPostId(post.id);
    try {
      await api(`/api/review/posts/${post.id}/recall/ignore`, {
        method: "POST",
      });
      toast.success("已忽略撤回申请，可在“已忽略撤回”筛选中找回。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "忽略撤回失败");
    } finally {
      setBusyPostId("");
    }
  }

  async function adminRecallPost(post: ReviewPostItem, options: { silent?: boolean } = {}) {
    setBusyPostId(post.id);
    try {
      await api(`/api/review/posts/${post.id}/recall/admin`, {
        method: "POST",
        body: JSON.stringify(options.silent ? { silent: true } : {}),
      });
      toast.success(options.silent ? "已静默撤回稿件，未通知作者。" : "已撤回稿件。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "撤回失败");
      await refreshAll();
    } finally {
      setBusyPostId("");
    }
  }

  async function confirmRecallAction() {
    if (!recallConfirm.open || !recallConfirm.post) {
      return;
    }
    const { mode, post } = recallConfirm;
    const reason = recallReason.trim();
    if (mode === "request" && reason.length === 0) {
      toast.error("请填写撤回理由。");
      return;
    }
    setRecallConfirm({ open: false, mode: null, post: null });
    setRecallReason("");
    if (mode === "request") {
      await requestRecallPost(post, reason);
      return;
    }
    if (mode === "reject") {
      await rejectRecallPost(post);
      return;
    }
    if (mode === "admin") {
      await adminRecallPost(post);
      return;
    }
    if (mode === "admin-silent") {
      await adminRecallPost(post, { silent: true });
      return;
    }
    await approveRecallPost(post);
  }

  async function submitReject() {
    const reason = rejectDialog.reason.trim();
    if (!rejectDialog.postId || reason.length === 0) {
      toast.error("请填写拒绝理由。");
      return;
    }
    await reviewPost(rejectDialog.postId, "reject", reason);
    setRejectDialog({ open: false, postId: "", displayId: null, reason: "" });
  }

  async function rejectWithoutReason() {
    if (!rejectDialog.postId) {
      return;
    }
    await reviewPost(rejectDialog.postId, "reject", "未填写具体理由");
    setRejectDialog({ open: false, postId: "", displayId: null, reason: "" });
  }

  async function openRenderPreview(post: PostItem) {
    setPreview((current) => {
      if (current.url) {
        URL.revokeObjectURL(current.url);
      }
      return {
        open: true,
        loading: true,
        error: "",
        url: "",
        title: `稿件 ${post.displayId} 渲染预览`,
      };
    });

    try {
      const response = await fetch(`/api/posts/${post.id}/render-preview`, {
        credentials: "include",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message || `预览失败：${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      setPreview((current) => ({
        ...current,
        loading: false,
        url,
      }));
    } catch (caught) {
      setPreview((current) => ({
        ...current,
        loading: false,
        error: caught instanceof Error ? caught.message : "渲染预览失败",
      }));
    }
  }

  function openImagePreview(images: PostImage[], index: number, title: string) {
    setImagePreview({
      open: true,
      images,
      index,
      title,
    });
  }

  function shiftImagePreview(offset: number) {
    setImagePreview((current) => {
      if (current.images.length === 0) {
        return current;
      }
      return {
        ...current,
        index: (current.index + offset + current.images.length) % current.images.length,
      };
    });
  }

  const activePreviewImage = imagePreview.images[imagePreview.index] ?? null;
  const reviewStatusLabel = reviewStatusOptions.find((option) => option.value === reviewStatus)?.label ?? "筛选";
  const filteredReviewPosts = reviewPosts.filter((post) => !pendingRecallPosts.some((recallPost) => recallPost.id === post.id));
  const detailPost = detailPostId ? pendingRecallPosts.find((post) => post.id === detailPostId) ?? reviewPosts.find((post) => post.id === detailPostId) ?? null : null;

  function setReviewPageWithQuery(page: number) {
    setReviewPage(page);
    writeQueryParams({ page: page > 1 ? page : null });
  }

  function setReviewStatusWithQuery(value: ReviewStatusFilter) {
    setReviewStatus(value);
    setReviewPage(1);
    writeReviewListPreferences(tenantId, { status: value, keyword: reviewKeyword });
    writeQueryParams({ status: value === "pending_approval" ? null : value, page: null, post: null });
    setDetailPostId("");
  }

  function applyReviewFilters() {
    const keyword = reviewKeyword.trim();
    setReviewPage(1);
    setDetailPostId("");
    writeReviewListPreferences(tenantId, { status: reviewStatus, keyword });
    writeQueryParams({ q: keyword || null, status: reviewStatus === "pending_approval" ? null : reviewStatus, page: null, post: null });
    void refreshReviewPosts(1);
  }

  function openPostDetail(postId: string) {
    setDetailPostId(postId);
    writeQueryParams({ post: postId }, "push");
  }

  function closePostDetail() {
    setDetailPostId("");
    writeQueryParams({ post: null });
  }

  return (
    <MarkdownContext.Provider value={Boolean(enableMarkdownRender)}>
    <ImageLightboxContext.Provider value={openImagePreview}>
    <div className="flex h-full min-h-0 flex-col px-4 pt-4">
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as PostsTab)} className="min-h-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <TabsList className={postTabsListClassName}>
            {canReview ? (
              <TabsTrigger value="review" className={postTabsTriggerClassName}>
                审核稿件
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="mine" className={postTabsTriggerClassName}>
              你的稿件
            </TabsTrigger>
            <TabsTrigger value="published" className={postTabsTriggerClassName}>
              已发布
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-500" title="开启后，你的每条稿件发布成功时会自动关注其评论，新评论每 12 小时私信提醒你">
              <Switch checked={autoFollowOwnPosts} disabled={autoFollowBusy} onCheckedChange={(value) => void setAutoFollowOwnPosts(value)} />
              <span className="hidden sm:inline">自动关注对我的稿件评论</span>
              <span className="sm:hidden">自动关注</span>
            </label>
            <Button variant="outline" size="sm" disabled={mineLoading || reviewLoading || pendingRecallLoading} onClick={() => void refreshAll()}>
              刷新
            </Button>
          </div>
        </div>
        <TabsContent value="mine" className="mt-3 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
          {mineLoading ? (
            <LoadingBlock title="正在加载你的稿件..." />
          ) : (
            <>
              <PostList
                posts={posts}
                busyCancelPostId={busyCancelPostId}
                busyRecallPostId={busyRecallPostId}
                busyFollowPostId={busyFollowPostId}
                onPreview={(post) => void openRenderPreview(post)}
                onImagePreview={(post, images, index) => openImagePreview(images, index, `稿件 ${post.displayId} 上传图片`)}
                onCancel={(post) => void cancelPost(post.id)}
                onRecall={(post) => {
                  setRecallReason("");
                  setRecallConfirm({ open: true, mode: "request", post });
                }}
                onToggleFollow={(post) => void toggleFollowPost(post)}
              />
              <PaginationControls pagination={minePagination} busy={mineLoading} onPageChange={onMinePageChange} />
            </>
          )}
        </TabsContent>
        <TabsContent value="published" className="mt-3 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
          {publishedLoading ? (
            <LoadingBlock title="正在加载已发布稿件..." />
          ) : publishedItems.length === 0 ? (
            <EmptyCard title="还没有已发布的稿件" />
          ) : (
            <>
              <div className="space-y-3">
                {publishedItems.map((item) => (
                  <PublishedFeedCard
                    key={item.key}
                    item={item}
                    canViewIdentity={canReview}
                    onImagePreview={(images, index, title) => openImagePreview(images, index, title)}
                  />
                ))}
              </div>
              <PaginationControls pagination={publishedPagination} busy={publishedLoading} onPageChange={setPublishedPage} />
            </>
          )}
        </TabsContent>
        {canReview ? (
          <TabsContent value="review" className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex md:hidden">
              <button
                type="button"
                className="flex min-h-9 w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-800 shadow-sm"
                onClick={() => setMobileFilterOpen(true)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SlidersHorizontalIcon className="size-4 shrink-0 text-slate-500" />
                  <span className="shrink-0">{reviewStatusLabel}</span>
                  <span className="min-w-0 truncate text-xs font-medium text-slate-500">{reviewKeyword.trim() ? reviewKeyword.trim() : "全部稿件"}</span>
                </span>
                <SearchIcon className="size-4 shrink-0 text-slate-400" />
              </button>
            </div>
            <div className="product-subsection mb-3 hidden gap-2 p-3 md:grid md:grid-cols-[160px_minmax(0,1fr)_auto]">
              <Select value={reviewStatus} onValueChange={(value) => setReviewStatusWithQuery(value as ReviewStatusFilter)}>
                <SelectTrigger className="h-10 w-full bg-white font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reviewStatusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                value={reviewKeyword}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400"
                placeholder="按内容或编号搜索"
                onChange={(event) => setReviewKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applyReviewFilters();
                  }
                }}
              />
              <Button variant="outline" className="h-10 font-bold" disabled={reviewLoading} onClick={() => {
                applyReviewFilters();
              }}>
                筛选
              </Button>
            </div>
            {reviewStatus === "pending_approval" && reviewKeyword.trim().length === 0 && filteredReviewPosts.length > 0 ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2">
                <p className="min-w-0 text-xs font-medium text-green-800">
                  确认本墙待审核稿件均已逐个审核后，可一键全部通过。
                </p>
                <Button
                  className="h-9 shrink-0 bg-green-600 font-bold text-white hover:bg-green-700"
                  disabled={reviewLoading || approveAllBusy}
                  onClick={() => setApproveAllOpen(true)}
                >
                  <CheckIcon className="mr-1 size-4" />
                  一键通过全部
                </Button>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <PendingRecallQueue
                posts={pendingRecallPosts}
                loading={pendingRecallLoading}
                busyPostId={busyPostId}
                onPreview={(post) => void openRenderPreview(post)}
                onImagePreview={(post, images, index) => openImagePreview(images, index, `稿件 ${post.displayId} 上传图片`)}
                onRecallApprove={(post) => setRecallConfirm({ open: true, mode: "approve", post })}
                onRecallReject={(post) => setRecallConfirm({ open: true, mode: "reject", post })}
                onRecallIgnore={(post) => void ignoreRecallPost(post)}
                onDetail={(post) => openPostDetail(post.id)}
              />
              {reviewLoading ? (
                <LoadingBlock title="正在加载审核稿件..." />
              ) : (
                <>
                  <ReviewList
                    posts={filteredReviewPosts}
                    busyPostId={busyPostId}
                    isAdmin={isAdmin}
                    onPreview={(post) => void openRenderPreview(post)}
                    onImagePreview={(post, images, index) => openImagePreview(images, index, `稿件 ${post.displayId} 上传图片`)}
                    onApprove={(id) => void reviewPost(id, "approve")}
                    onReject={(post) => setRejectDialog({ open: true, postId: post.id, displayId: post.displayId, reason: "" })}
                    onRecallApprove={(post) => setRecallConfirm({ open: true, mode: "approve", post })}
                    onRecallReject={(post) => setRecallConfirm({ open: true, mode: "reject", post })}
                    onRecallDirect={(post) => setRecallConfirm({ open: true, mode: "admin", post })}
                    onRecallDirectSilent={(post) => setRecallConfirm({ open: true, mode: "admin-silent", post })}
                    onDetail={(post) => openPostDetail(post.id)}
                    emptyTitle={pendingRecallPosts.length > 0 ? "当前筛选下没有其他稿件" : "当前筛选下没有稿件"}
                  />
                  <PaginationControls pagination={reviewPagination} busy={reviewLoading} onPageChange={setReviewPageWithQuery} />
                </>
              )}
            </div>
          </TabsContent>
        ) : null}
      </Tabs>
      <Dialog open={preview.open} onOpenChange={(open) => setPreview((current) => ({ ...current, open }))}>
        <DialogContent className="w-[min(720px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>{preview.title}</DialogTitle>
            <DialogDescription>这里展示实际发布前生成的稿件渲染图。</DialogDescription>
          </DialogHeader>
          <div className="min-h-48 overflow-auto px-5 pb-5">
            {preview.loading ? <p className="py-12 text-center text-sm font-bold text-slate-500">正在渲染...</p> : null}
            {preview.error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{preview.error}</p> : null}
            {preview.url ? <img src={preview.url} alt={preview.title} className="mx-auto w-full max-w-[560px] rounded-md border border-slate-200 bg-white" /> : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>筛选审核稿件</DialogTitle>
            <DialogDescription>选择状态，或按内容和编号搜索。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-5 pb-5">
            <label className="grid gap-1 text-sm font-semibold text-slate-800">
              状态
              <Select value={reviewStatus} onValueChange={(value) => setReviewStatusWithQuery(value as ReviewStatusFilter)}>
                <SelectTrigger className="h-10 w-full bg-white font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reviewStatusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-800">
              搜索
              <input
                value={reviewKeyword}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400"
                placeholder="按内容或编号搜索"
                onChange={(event) => setReviewKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setMobileFilterOpen(false);
                    applyReviewFilters();
                  }
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setReviewStatus("pending_approval");
                  setReviewKeyword("");
                  setReviewPage(1);
                  setDetailPostId("");
                  writeReviewListPreferences(tenantId, defaultReviewListPreferences);
                  writeQueryParams({ status: null, q: null, page: null, post: null });
                }}
              >
                重置
              </Button>
              <Button
                disabled={reviewLoading}
                onClick={() => {
                  setMobileFilterOpen(false);
                  applyReviewFilters();
                }}
              >
                应用筛选
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <PostDetailDialog
        post={detailPost}
        open={Boolean(detailPostId)}
        canDirectRecall={isAdmin}
        recallBusy={detailPost ? busyPostId === detailPost.id : false}
        onOpenChange={(open) => {
          if (!open) {
            closePostDetail();
          }
        }}
        onPreview={(post) => void openRenderPreview(post)}
        onImagePreview={(post, images, index) => openImagePreview(images, index, `稿件 ${post.displayId} 上传图片`)}
        onRecallDirect={(post) => {
          closePostDetail();
          setRecallConfirm({ open: true, mode: "admin", post });
        }}
        onRecallDirectSilent={(post) => {
          closePostDetail();
          setRecallConfirm({ open: true, mode: "admin-silent", post });
        }}
      />
      <Dialog open={imagePreview.open} onOpenChange={(open) => setImagePreview((current) => ({ ...current, open }))}>
        <DialogContent className="w-[min(920px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>{imagePreview.title}</DialogTitle>
            <DialogDescription>
              {imagePreview.images.length > 0 ? `${imagePreview.index + 1} / ${imagePreview.images.length}` : "暂无图片"}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-5">
            {activePreviewImage ? (
              <div className="grid gap-3">
                <div className="grid max-h-[70dvh] place-items-center overflow-auto rounded-md border border-slate-200 bg-slate-50">
                  <img
                    src={getPostImageUrl(activePreviewImage)}
                    alt={activePreviewImage.fileName ?? imagePreview.title}
                    referrerPolicy="no-referrer"
                    className="max-h-[70dvh] w-auto max-w-full object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-bold text-slate-500">{activePreviewImage.fileName ?? "上传图片"}</p>
                  {imagePreview.images.length > 1 ? (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => shiftImagePreview(-1)}>
                        上一张
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => shiftImagePreview(1)}>
                        下一张
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={rejectDialog.open} onOpenChange={(open) => setRejectDialog((current) => ({ ...current, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝稿件 {rejectDialog.displayId ? `#${rejectDialog.displayId}` : ""}</DialogTitle>
            <DialogDescription>填写给投稿人的拒绝理由，系统会尝试通过本校园墙的所有墙号私聊通知。</DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-5">
            <Textarea
              className="min-h-28 bg-white"
              value={rejectDialog.reason}
              onChange={(event) => setRejectDialog((current) => ({ ...current, reason: event.target.value }))}
              placeholder="例如：信息不完整，请补充时间、地点和联系方式后重新投稿。"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectDialog({ open: false, postId: "", displayId: null, reason: "" })}>
                取消
              </Button>
              <Button variant="outline" disabled={busyPostId === rejectDialog.postId} onClick={() => void rejectWithoutReason()}>
                不填写理由
              </Button>
              <Button disabled={busyPostId === rejectDialog.postId || rejectDialog.reason.trim().length === 0} onClick={() => void submitReject()}>
                确认拒绝
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={recallConfirm.open}
        onOpenChange={(open) => {
          if (!open) {
            setRecallConfirm({ open: false, mode: null, post: null });
            setRecallReason("");
          }
        }}
      >
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>
              {recallConfirm.open && recallConfirm.mode === "approve"
                ? "同意撤回申请？"
                : recallConfirm.open && recallConfirm.mode === "reject"
                  ? "拒绝撤回申请？"
                  : recallConfirm.open && recallConfirm.mode === "admin"
                    ? "直接撤回稿件？"
                    : recallConfirm.open && recallConfirm.mode === "admin-silent"
                      ? "静默撤回稿件？"
                      : "申请撤回稿件？"}
            </DialogTitle>
            <DialogDescription>
              {recallConfirm.open && recallConfirm.mode === "approve"
                ? `确认同意撤回稿件 #${recallConfirm.post.displayId} 吗？已发布内容会被设置为仅自己可见。`
                : recallConfirm.open && recallConfirm.mode === "reject"
                  ? `确认拒绝稿件 #${recallConfirm.post.displayId} 的撤回申请吗？拒绝后稿件状态会恢复为已发表。`
                : recallConfirm.open && recallConfirm.mode === "admin"
                  ? `确认直接撤回稿件 #${recallConfirm.post.displayId} 吗？已发布内容会被设置为仅自己可见，无需作者申请。`
                : recallConfirm.open && recallConfirm.mode === "admin-silent"
                  ? `确认静默撤回稿件 #${recallConfirm.post.displayId} 吗？已发布内容会被隐藏，但不会私聊通知作者；审核群仍会收到记录。`
                : recallConfirm.open
                  ? `确认申请撤回稿件 #${recallConfirm.post.displayId} 吗？审核员同意后，已发布内容会被隐藏。`
                  : ""}
            </DialogDescription>
          </DialogHeader>
          {recallConfirm.open && recallConfirm.mode === "request" ? (
            <div className="px-5 pb-2">
              <Textarea
                className="min-h-24 bg-white"
                value={recallReason}
                onChange={(event) => setRecallReason(event.target.value)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRecallConfirm({ open: false, mode: null, post: null });
                setRecallReason("");
              }}
            >
              取消
            </Button>
            <Button
              disabled={
                recallConfirm.open &&
                ((recallConfirm.mode === "request" && busyRecallPostId === recallConfirm.post.id) ||
                  (recallConfirm.mode === "approve" && busyPostId === recallConfirm.post.id) ||
                  (recallConfirm.mode === "reject" && busyPostId === recallConfirm.post.id) ||
                  (recallConfirm.mode === "admin" && busyPostId === recallConfirm.post.id) ||
                  (recallConfirm.mode === "admin-silent" && busyPostId === recallConfirm.post.id) ||
                  (recallConfirm.mode === "request" && recallReason.trim().length === 0))
              }
              onClick={() => void confirmRecallAction()}
            >
              {recallConfirm.open && recallConfirm.mode === "approve"
                ? "同意撤回"
                : recallConfirm.open && recallConfirm.mode === "reject"
                  ? "拒绝撤回"
                  : recallConfirm.open && recallConfirm.mode === "admin"
                    ? "确认撤回"
                    : recallConfirm.open && recallConfirm.mode === "admin-silent"
                      ? "确认静默撤回"
                      : "提交申请"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={approveAllOpen} onOpenChange={(open) => { if (!approveAllBusy) setApproveAllOpen(open); }}>
        <DialogContent className="w-[min(460px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>一键通过全部待审核稿件？</DialogTitle>
            <DialogDescription>
              此操作会把当前校园墙下所有「待审核」稿件全部通过并进入发布流程，无法撤销。请确认你已经逐个审核过这些稿件，确保内容均符合发布要求。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={approveAllBusy} onClick={() => setApproveAllOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-green-600 font-bold text-white hover:bg-green-700"
              disabled={approveAllBusy}
              onClick={() => void approveAllPosts()}
            >
              我已逐个审核，全部通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </ImageLightboxContext.Provider>
    </MarkdownContext.Provider>
  );
}

function defaultPagination(): Pagination {
  return {
    page: 1,
    limit: 10,
    total: 0,
    pageCount: 1,
  };
}

function PostDetailDialog({
  post,
  open,
  canDirectRecall = false,
  recallBusy = false,
  onOpenChange,
  onPreview,
  onImagePreview,
  onRecallDirect,
  onRecallDirectSilent,
}: {
  post: ReviewPostItem | null;
  open: boolean;
  canDirectRecall?: boolean;
  recallBusy?: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (post: ReviewPostItem) => void;
  onImagePreview: (post: ReviewPostItem, images: PostImage[], index: number) => void;
  onRecallDirect?: (post: ReviewPostItem) => void;
  onRecallDirectSilent?: (post: ReviewPostItem) => void;
}) {
  const images = post ? getPostImages(post.attachments) : [];
  const showDirectRecall = Boolean(post && canDirectRecall && post.status === "published" && onRecallDirect);
  const showDirectRecallSilent = Boolean(post && canDirectRecall && post.status === "published" && onRecallDirectSilent);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{post ? `稿件 #${post.displayId}` : "稿件详情"}</DialogTitle>
          <DialogDescription>{post ? `作者 ${post.author?.displayName ?? post.author?.qqUin ?? "未知用户"} · ${formatFullDateTime(post.createdAt)}` : "正在定位稿件..."}</DialogDescription>
        </DialogHeader>
        {post ? (
          <div className="grid gap-3 px-5 pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">#{post.displayId}</Badge>
              <Badge variant="secondary">{post.status === "publishing" && post.batch?.collecting ? waitingBatchLabel : statusLabels[post.status] ?? post.status}</Badge>
              {post.anonymous ? <Badge variant="outline">匿名展示</Badge> : <Badge variant="outline">实名展示</Badge>}
              <Badge variant="outline">{images.length} 张图片</Badge>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="whitespace-pre-wrap text-sm font-semibold text-slate-800">{post.text}</p>
            </div>
            {post.status === "pending_recall" ? <RecallReasonBlock reason={post.recallReason} /> : null}
            <div className="grid gap-1 text-xs font-semibold text-slate-500 sm:grid-cols-2">
              <span>稿件 ID：{post.id}</span>
              <span>更新时间：{formatFullDateTime(post.updatedAt)}</span>
              <span>作者 QQ：{post.author?.qqUin ?? "未知"}</span>
              <span>作者 ID：{post.author?.id ?? "未知"}</span>
            </div>
            <PostTimeline timeline={post.timeline} />
            {images.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {images.map((image, index) => (
                  <button key={`${image.key ?? image.url ?? index}`} type="button" className="relative size-16 overflow-hidden rounded-md border border-slate-200 bg-white" onClick={() => onImagePreview(post, images, index)}>
                    <img src={getPostImageUrl(image)} alt={image.fileName ?? `稿件附件 ${index + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
              <Button variant="outline" onClick={() => onPreview(post)}>渲染预览</Button>
              {showDirectRecallSilent && onRecallDirectSilent ? (
                <Button variant="outline" disabled={recallBusy} onClick={() => onRecallDirectSilent(post)}>
                  <RotateCcwIcon data-icon="inline-start" />
                  静默撤回
                </Button>
              ) : null}
              {showDirectRecall && onRecallDirect ? (
                <Button disabled={recallBusy} onClick={() => onRecallDirect(post)}>
                  <RotateCcwIcon data-icon="inline-start" />
                  撤回稿件
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="px-5 pb-5"><LoadingBlock title="正在从当前筛选结果中定位稿件..." /></div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 稿件完整时间线：谁、什么时候、做了什么、状态如何变化。系统自动操作不显示操作人。 */
function PostTimeline({ timeline }: { timeline?: PostTimelineEntry[] | undefined }) {
  if (!timeline || timeline.length === 0) {
    return null;
  }
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <p className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-xs font-black text-slate-600">
        <ClockIcon className="size-3.5" />
        操作时间线
      </p>
      <ol className="grid gap-0 px-3 py-2">
        {timeline.map((entry, index) => {
          const isLast = index === timeline.length - 1;
          const actor = entry.actorName ?? (entry.actorQq ? `QQ ${entry.actorQq}` : null);
          const statusChanged = entry.oldStatus !== entry.newStatus;
          return (
            <li key={`${entry.createdAt}-${index}`} className="flex gap-2.5">
              {/* 连续时间轴：竖线在节点处对齐贯穿，圆点叠在线上 */}
              <div className="relative flex w-2 flex-col items-center">
                {index > 0 ? <span className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-slate-200" /> : null}
                {!isLast ? <span className="absolute bottom-0 left-1/2 top-2 w-px -translate-x-1/2 bg-slate-200" /> : null}
                <span className={`relative mt-1 size-2 shrink-0 rounded-full ring-2 ring-white ${statusDotStyles[entry.newStatus] ?? "bg-slate-400"}`} />
              </div>
              <div className={`min-w-0 flex-1 ${isLast ? "pb-0.5" : "pb-3"}`}>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-5">
                  <span className="font-bold text-slate-800">{actor ?? "系统"}</span>
                  {actor ? <span className="text-slate-400">操作</span> : <span className="text-slate-400">自动</span>}
                  {statusChanged ? (
                    <span className="inline-flex items-center gap-1">
                      {entry.oldStatus ? <span className="text-slate-400">{statusLabels[entry.oldStatus] ?? entry.oldStatus}</span> : null}
                      <span className="text-slate-300">→</span>
                      <span className="font-semibold text-slate-700">{statusLabels[entry.newStatus] ?? entry.newStatus}</span>
                    </span>
                  ) : (
                    <span className="font-semibold text-slate-700">{statusLabels[entry.newStatus] ?? entry.newStatus}</span>
                  )}
                  <span className="text-slate-400">· {formatFullDateTime(entry.createdAt)}</span>
                </div>
                {entry.comment ? <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{entry.comment}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ReviewList({
  posts,
  busyPostId,
  isAdmin,
  emptyTitle = "当前筛选下没有稿件",
  onPreview,
  onImagePreview,
  onApprove,
  onReject,
  onRecallApprove,
  onRecallReject,
  onRecallDirect,
  onRecallDirectSilent,
  onDetail,
}: {
  posts: ReviewPostItem[];
  busyPostId: string;
  isAdmin: boolean;
  emptyTitle?: string;
  onPreview: (post: ReviewPostItem) => void;
  onImagePreview: (post: ReviewPostItem, images: PostImage[], index: number) => void;
  onApprove: (id: string) => void;
  onReject: (post: ReviewPostItem) => void;
  onRecallApprove: (post: ReviewPostItem) => void;
  onRecallReject: (post: ReviewPostItem) => void;
  onRecallDirect: (post: ReviewPostItem) => void;
  onRecallDirectSilent: (post: ReviewPostItem) => void;
  onDetail: (post: ReviewPostItem) => void;
}) {
  if (posts.length === 0) {
    return <EmptyCard title={emptyTitle} />;
  }

  return (
    <div className="flex flex-col gap-2 md:gap-3">
      {posts.map((post, index) => (
        <ReviewCard
          key={post.id}
          post={post}
          palette={postCardPalettes[index % postCardPalettes.length] ?? defaultPostCardPalette}
          busy={busyPostId === post.id}
          canDirectRecall={isAdmin}
          onPreview={() => onPreview(post)}
          onImagePreview={(images, imageIndex) => onImagePreview(post, images, imageIndex)}
          onApprove={() => onApprove(post.id)}
          onReject={() => onReject(post)}
          onRecallApprove={() => onRecallApprove(post)}
          onRecallReject={() => onRecallReject(post)}
          onRecallDirect={() => onRecallDirect(post)}
          onRecallDirectSilent={() => onRecallDirectSilent(post)}
          onDetail={() => onDetail(post)}
        />
      ))}
    </div>
  );
}

function PendingRecallQueue({
  posts,
  loading,
  busyPostId,
  onPreview,
  onImagePreview,
  onRecallApprove,
  onRecallReject,
  onRecallIgnore,
  onDetail,
}: {
  posts: ReviewPostItem[];
  loading: boolean;
  busyPostId: string;
  onPreview: (post: ReviewPostItem) => void;
  onImagePreview: (post: ReviewPostItem, images: PostImage[], index: number) => void;
  onRecallApprove: (post: ReviewPostItem) => void;
  onRecallReject: (post: ReviewPostItem) => void;
  onRecallIgnore: (post: ReviewPostItem) => void;
  onDetail: (post: ReviewPostItem) => void;
}) {
  if (loading && posts.length === 0) {
    return (
      <div className="mb-3">
        <LoadingBlock title="正在检查撤回请求..." />
      </div>
    );
  }

  if (posts.length === 0) {
    return null;
  }

  return (
    <section className="mb-4 grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-900/60 dark:bg-violet-950/30">
        <div className="min-w-0">
          <p className="text-sm font-black text-violet-900 dark:text-violet-100">待处理撤回请求</p>
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">这些稿件固定显示在顶部，不受当前筛选条件影响。</p>
        </div>
        <Badge className="rounded-full bg-white text-violet-700 shadow-none ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-100 dark:ring-violet-800">{posts.length} 条</Badge>
      </div>
      <div className="flex flex-col gap-2 md:gap-3">
        {posts.map((post, index) => (
          <ReviewCard
            key={post.id}
            post={post}
            palette={postCardPalettes[index % postCardPalettes.length] ?? defaultPostCardPalette}
            busy={busyPostId === post.id}
            onPreview={() => onPreview(post)}
            onImagePreview={(images, imageIndex) => onImagePreview(post, images, imageIndex)}
            onApprove={() => undefined}
            onReject={() => undefined}
            onRecallApprove={() => onRecallApprove(post)}
            onRecallReject={() => onRecallReject(post)}
            onRecallIgnore={() => onRecallIgnore(post)}
            onDetail={() => onDetail(post)}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewCard({
  post,
  palette,
  busy,
  canDirectRecall = false,
  onPreview,
  onImagePreview,
  onApprove,
  onReject,
  onRecallApprove,
  onRecallReject,
  onRecallIgnore,
  onRecallDirect,
  onRecallDirectSilent,
  onDetail,
}: {
  post: ReviewPostItem;
  palette: string;
  busy: boolean;
  canDirectRecall?: boolean;
  onPreview: () => void;
  onImagePreview: (images: PostImage[], index: number) => void;
  onApprove: () => void;
  onReject: () => void;
  onRecallApprove: () => void;
  onRecallReject: () => void;
  onRecallIgnore?: () => void;
  onRecallDirect?: () => void;
  onRecallDirectSilent?: () => void;
  onDetail: () => void;
}) {
  const images = getPostImages(post.attachments);
  const authorName = post.author?.displayName ?? "未命名用户";
  const authorQq = post.author?.qqUin ?? "未知 QQ";
  const statusClassName = statusStyles[post.status] ?? "bg-white text-slate-600";
  const canReviewPost = post.status === "pending_approval";
  const canApproveRecall = post.status === "pending_recall";
  const canDirectRecallPost = canDirectRecall && post.status === "published" && Boolean(onRecallDirect);
  const cardBg = postCardBgStyle(post.bgColor);
  const cardTextColor = postCardTextColor(post.textColor);

  return (
    <Card className={`overflow-hidden rounded-md border shadow-none ${palette}`} style={cardBg ? { background: cardBg.replace("background: ", "") } : undefined}>
      <CardContent className="grid gap-2 p-2.5 md:gap-3 md:p-3">
        <PostMetaHeader
          displayId={`稿件 ${post.displayId}`}
          anonymous={post.anonymous}
          anonymousLabel={post.anonymous ? "匿名展示" : "实名展示"}
          imageCount={images.length}
          status={post.status}
          statusClassName={statusClassName}
          submissionChannel={post.submissionChannel}
          batch={post.batch}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onDetail}>详情</Button>
              <PreviewButton onClick={onPreview} />
            </div>
          }
        />

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500">
          <span className="min-w-0 truncate text-slate-800">{authorName}</span>
          <span>QQ {authorQq}</span>
        </div>

        <PostTextBlock text={post.text} createdAt={post.createdAt} updatedAt={post.updatedAt} compact {...(cardTextColor ? { textColor: cardTextColor } : {})} />

        {images.length > 0 ? <ImageGallery images={images} compact onImageClick={onImagePreview} /> : null}

        {canApproveRecall ? <RecallReasonBlock reason={post.recallReason} /> : null}
        {canApproveRecall && post.recallIgnored ? <IgnoredRecallBlock ignoredAt={post.recallIgnoredAt} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span>{formatPostDate(post.createdAt)}</span>
          </div>
          {canReviewPost ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" className="font-medium" disabled={busy} onClick={onApprove}>
                <CheckIcon data-icon="inline-start" />
                通过
              </Button>
              <Button size="sm" variant="outline" className="font-medium" disabled={busy} onClick={onReject}>
                <XIcon data-icon="inline-start" />
                拒绝
              </Button>
            </div>
          ) : canApproveRecall ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="font-medium" disabled={busy} onClick={onRecallReject}>
                <XIcon data-icon="inline-start" />
                拒绝撤回
              </Button>
              {!post.recallIgnored && onRecallIgnore ? (
                <Button size="sm" variant="outline" className="font-medium" disabled={busy} onClick={onRecallIgnore}>
                  忽略
                </Button>
              ) : null}
              <Button size="sm" className="font-medium" disabled={busy} onClick={onRecallApprove}>
                <RotateCcwIcon data-icon="inline-start" />
                同意撤回
              </Button>
            </div>
          ) : canDirectRecallPost ? (
            <div className="flex flex-wrap gap-2">
              {onRecallDirectSilent ? (
                <Button size="sm" variant="outline" className="font-medium" disabled={busy} onClick={onRecallDirectSilent}>
                  <RotateCcwIcon data-icon="inline-start" />
                  静默撤回
                </Button>
              ) : null}
              <Button size="sm" variant="outline" className="font-medium" disabled={busy} onClick={onRecallDirect}>
                <RotateCcwIcon data-icon="inline-start" />
                撤回
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PostList({
  posts,
  busyCancelPostId,
  busyRecallPostId,
  busyFollowPostId,
  onPreview,
  onImagePreview,
  onCancel,
  onRecall,
  onToggleFollow,
}: {
  posts: PostItem[];
  busyCancelPostId: string;
  busyRecallPostId: string;
  busyFollowPostId: string;
  onPreview: (post: PostItem) => void;
  onImagePreview: (post: PostItem, images: PostImage[], index: number) => void;
  onCancel: (post: PostItem) => void;
  onRecall: (post: PostItem) => void;
  onToggleFollow: (post: PostItem) => void;
}) {
  if (posts.length === 0) {
    return <EmptyCard title="还没有稿件，可以先去投稿页写一条" />;
  }

  return (
    <div className="flex flex-col gap-2 md:gap-3">
      {posts.map((post, index) => (
        <PostCard
          key={post.id}
          post={post}
          palette={postCardPalettes[index % postCardPalettes.length] ?? defaultPostCardPalette}
          cancelBusy={busyCancelPostId === post.id}
          recallBusy={busyRecallPostId === post.id}
          followBusy={busyFollowPostId === post.id}
          onPreview={() => onPreview(post)}
          onImagePreview={(images, imageIndex) => onImagePreview(post, images, imageIndex)}
          onCancel={() => onCancel(post)}
          onRecall={() => onRecall(post)}
          onToggleFollow={() => onToggleFollow(post)}
        />
      ))}
    </div>
  );
}

function PostCard({
  post,
  palette,
  cancelBusy,
  recallBusy,
  followBusy,
  onPreview,
  onImagePreview,
  onCancel,
  onRecall,
  onToggleFollow,
}: {
  post: PostItem;
  palette: string;
  cancelBusy: boolean;
  recallBusy: boolean;
  followBusy: boolean;
  onPreview: () => void;
  onImagePreview: (images: PostImage[], index: number) => void;
  onCancel: () => void;
  onRecall: () => void;
  onToggleFollow: () => void;
}) {
  const images = getPostImages(post.attachments);
  const statusClassName = statusStyles[post.status] ?? "bg-white text-slate-600";
  const canCancel = post.status === "pending_approval";
  const canRecall = post.status === "published";
  const canFollow = post.status === "published";
  const cardBg = postCardBgStyle(post.bgColor);
  const cardTextColor = postCardTextColor(post.textColor);

  return (
    <Card className={`overflow-hidden rounded-md border shadow-none ${palette}`} style={cardBg ? { background: cardBg.replace("background: ", "") } : undefined}>
      <CardContent className="grid gap-2 p-2.5 md:gap-3 md:p-3">
        <PostMetaHeader
          displayId={post.displayId}
          anonymous={post.anonymous}
          anonymousLabel={post.anonymous ? "匿名展示" : "实名展示"}
          imageCount={images.length}
          status={post.status}
          statusClassName={statusClassName}
          submissionChannel={post.submissionChannel}
          batch={post.batch}
          title={post.title || "未命名稿件"}
          actions={
            <>
              <PreviewButton onClick={onPreview} />
              {canFollow ? <FollowButton following={Boolean(post.following)} busy={followBusy} onClick={onToggleFollow} /> : null}
              {canCancel ? <CancelButton busy={cancelBusy} onClick={onCancel} /> : null}
              {canRecall ? <RecallRequestButton busy={recallBusy} onClick={onRecall} /> : null}
            </>
          }
        />

        <PostTextBlock text={post.text} createdAt={post.createdAt} compact {...(cardTextColor ? { textColor: cardTextColor } : {})} />

        {images.length > 0 ? <ImageGallery images={images} compact onImageClick={onImagePreview} /> : null}

        {post.status === "pending_recall" ? <RecallReasonBlock reason={post.recallReason} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3.5" />
            {formatPostDate(post.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <SparklesIcon className="size-3.5" />
            {post.status === "published" ? "已发布到墙上" : post.status === "publishing" && post.batch?.collecting ? waitingBatchLabel : statusLabels[post.status] ?? "处理中"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

const submissionChannelLabels: Record<string, { label: string; className: string }> = {
  web: { label: "网页投稿", className: "bg-sky-100 text-sky-700" },
  private: { label: "对话投稿", className: "bg-amber-100 text-amber-700" },
};

function PostMetaHeader({
  displayId,
  anonymous,
  anonymousLabel,
  imageCount,
  status,
  statusClassName,
  submissionChannel,
  batch,
  title,
  actions,
}: {
  displayId: string | number;
  anonymous: boolean;
  anonymousLabel: string;
  imageCount: number;
  status: string;
  statusClassName: string;
  submissionChannel?: "web" | "private";
  batch?: { postCount: number; otherDisplayIds: number[]; collecting?: boolean } | null | undefined;
  title?: string;
  actions?: ReactNode;
}) {
  // 批量收集中（后端为 publishing）派生为"等待批次"，并据此覆盖徽章配色，
  // 这样两个调用方传入的 statusClassName 不一致时也能自洽。
  const displayStatus = status === "publishing" && batch?.collecting ? WAITING_BATCH_STATUS : status;
  const effectiveStatusClassName = displayStatus === WAITING_BATCH_STATUS ? statusStyles[WAITING_BATCH_STATUS] ?? statusClassName : statusClassName;
  return (
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
          <InfoPill icon={HashIcon}>{displayId}</InfoPill>
          <VisibilityPill anonymous={anonymous}>{anonymousLabel}</VisibilityPill>
          {submissionChannel ? (
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold leading-4 ${submissionChannelLabels[submissionChannel]?.className ?? "bg-slate-100 text-slate-600"}`}>
              {submissionChannelLabels[submissionChannel]?.label ?? submissionChannel}
            </span>
          ) : null}
          {batch && batch.postCount > 1 ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-xs font-semibold leading-4 text-violet-700"
              title={batch.otherDisplayIds.length > 0 ? `与 ${batch.otherDisplayIds.map((id) => `#${id}`).join(" ")} 合并为一条说说` : "批量发布"}
            >
              批量 · 同说说 {batch.postCount} 条
            </span>
          ) : null}
          <InfoPill icon={ImageIcon}>{imageCount} 个附件</InfoPill>
        </div>
        {title ? <h3 className="mt-1.5 line-clamp-1 text-sm font-semibold leading-5 text-slate-950 md:mt-2 md:line-clamp-2 md:text-base md:leading-6">{title}</h3> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:justify-end md:gap-2">
        {actions}
        <Badge className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold shadow-none md:px-3 ${effectiveStatusClassName}`}>
          <span className={`size-1.5 shrink-0 rounded-full ${statusDotStyles[displayStatus] ?? "bg-slate-400"}`} />
          {displayStatusLabel(displayStatus)}
        </Badge>
      </div>
    </div>
  );
}

function PreviewButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-7 px-2 text-xs font-bold md:h-8" onClick={onClick}>
      <ImageIcon data-icon="inline-start" />
      预览图
    </Button>
  );
}

function CancelButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-8 px-2 text-xs font-bold text-red-700 hover:text-red-700" disabled={busy} onClick={onClick}>
      <XIcon data-icon="inline-start" />
      取消
    </Button>
  );
}

function RecallRequestButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-8 px-2 text-xs font-bold text-violet-700 hover:text-violet-700" disabled={busy} onClick={onClick}>
      <RotateCcwIcon data-icon="inline-start" />
      申请撤回
    </Button>
  );
}

function FollowButton({ following, busy, onClick }: { following: boolean; busy: boolean; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-8 px-2 text-xs font-bold ${following ? "border-blue-300 bg-blue-50 text-blue-700 hover:text-blue-700" : "text-slate-600 hover:text-slate-700"}`}
      disabled={busy}
      onClick={onClick}
      title={following ? "已关注，每 12 小时私信推送新评论。点击取消关注" : "关注后，每 12 小时把新评论私信推送给你"}
    >
      {following ? <BellRingIcon data-icon="inline-start" /> : <BellIcon data-icon="inline-start" />}
      {following ? "已关注" : "关注评论"}
    </Button>
  );
}

function PublishedFeedAuthorLine({ post, canViewIdentity }: { post: PublishedFeedItem["posts"][number]; canViewIdentity: boolean }) {
  // 后端已脱敏：普通用户看匿名稿件时 author 为 null。
  if (post.author === null) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">匿名</span>
      </div>
    );
  }
  // 实名稿件：所有成员可见昵称 + QQ。匿名稿件 + 审核员/管理员：显示真实身份并标注「匿名」。
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500">
      {post.anonymous && canViewIdentity ? (
        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">匿名（仅审核可见实名）</span>
      ) : null}
      <span className="min-w-0 truncate text-slate-800">{post.author.displayName || "未命名用户"}</span>
      <span>QQ {post.author.qqUin}</span>
    </div>
  );
}

function PublishedFeedPostBlock({
  post,
  canViewIdentity,
  onImagePreview,
}: {
  post: PublishedFeedItem["posts"][number];
  canViewIdentity: boolean;
  onImagePreview: (images: PostImage[], index: number, title: string) => void;
}) {
  const images = getPostImages(post.attachments);
  const cardBg = postCardBgStyle(post.bgColor);
  const cardTextColor = postCardTextColor(post.textColor);
  return (
    <div className="grid gap-2" style={cardBg ? { background: cardBg.replace("background: ", "") } : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded bg-sky-50 px-1.5 py-0.5 text-xs font-bold text-sky-700">稿件 {post.displayId}</span>
      </div>
      <PublishedFeedAuthorLine post={post} canViewIdentity={canViewIdentity} />
      <PostTextBlock text={post.text} createdAt={post.createdAt} {...(cardTextColor ? { textColor: cardTextColor } : {})} />
      {images.length > 0 ? (
        <ImageGallery images={images} compact onImageClick={(imgs, index) => onImagePreview(imgs, index, `稿件 ${post.displayId} 上传图片`)} />
      ) : null}
    </div>
  );
}

function PublishedFeedCard({
  item,
  canViewIdentity,
  onImagePreview,
}: {
  item: PublishedFeedItem;
  canViewIdentity: boolean;
  onImagePreview: (images: PostImage[], index: number, title: string) => void;
}) {
  const isBatch = item.kind === "batch";
  return (
    <Card className="overflow-hidden rounded-md border border-slate-200 shadow-none">
      <CardContent className="grid gap-3 p-2.5 md:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {isBatch ? (
            <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">批量 · {item.posts.length} 条稿件 · 同一条说说</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">独立发布</Badge>
          )}
          <span className="text-xs font-semibold text-slate-400">发布于 {formatFullDateTime(item.publishedAt)}</span>
        </div>

        {isBatch ? (
          <div className="grid gap-3 divide-y divide-slate-100">
            {item.posts.map((post, index) => (
              <div key={post.id} className={index > 0 ? "pt-3" : ""}>
                <PublishedFeedPostBlock post={post} canViewIdentity={canViewIdentity} onImagePreview={onImagePreview} />
              </div>
            ))}
          </div>
        ) : (
          item.posts[0] ? <PublishedFeedPostBlock post={item.posts[0]} canViewIdentity={canViewIdentity} onImagePreview={onImagePreview} /> : null
        )}

        {/* 互动数据按说说聚合，整张卡片只显示一份 */}
        <QZoneStatsBlock stats={item.qzoneStats} />
      </CardContent>
    </Card>
  );
}

function PostTextBlock({ text, createdAt, updatedAt, compact = false, textColor }: { text: string; createdAt: string; updatedAt?: string; compact?: boolean; textColor?: string }) {
  const enableMarkdown = useContext(MarkdownContext);

  if (compact) {
    if (enableMarkdown) {
      return (
        <div className="rounded-md border border-slate-100 bg-slate-50/70 px-2.5 py-2" style={textColor ? { color: textColor } : undefined}>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1">
              <FileTextIcon className="size-3" />
              {text.length} 字
            </span>
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3" />
              {formatFullDateTime(createdAt)}
            </span>
            {updatedAt && updatedAt !== createdAt ? <span className="hidden sm:inline">更新 {formatFullDateTime(updatedAt)}</span> : null}
          </div>
          <div className="markdown-content line-clamp-3 text-sm font-medium leading-5 md:line-clamp-4" style={textColor ? { color: textColor } : undefined} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        </div>
      );
    }
    return (
      <div className="rounded-md border border-slate-100 bg-slate-50/70 px-2.5 py-2" style={textColor ? { color: textColor } : undefined}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <FileTextIcon className="size-3" />
            {text.length} 字
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3" />
            {formatFullDateTime(createdAt)}
          </span>
          {updatedAt && updatedAt !== createdAt ? <span className="hidden sm:inline">更新 {formatFullDateTime(updatedAt)}</span> : null}
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap text-sm font-medium leading-5 md:line-clamp-4" style={textColor ? { color: textColor } : undefined}>{text}</p>
      </div>
    );
  }

  if (enableMarkdown) {
    return (
      <div className="product-row-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <FileTextIcon className="size-3.5" />
            {text.length} 字
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3.5" />
            {formatFullDateTime(createdAt)}
          </span>
          {updatedAt && updatedAt !== createdAt ? <span>更新 {formatFullDateTime(updatedAt)}</span> : null}
        </div>
        <div className="markdown-content text-[15px] font-medium leading-7" style={textColor ? { color: textColor } : undefined} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      </div>
    );
  }

  return (
    <div className="product-row-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1">
          <FileTextIcon className="size-3.5" />
          {text.length} 字
        </span>
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="size-3.5" />
          {formatFullDateTime(createdAt)}
        </span>
        {updatedAt && updatedAt !== createdAt ? <span>更新 {formatFullDateTime(updatedAt)}</span> : null}
      </div>
      <p className="whitespace-pre-wrap text-[15px] font-medium leading-7" style={textColor ? { color: textColor } : undefined}>{text}</p>
    </div>
  );
}

function QZoneStatsBlock({ stats }: { stats: PostItem["qzoneStats"] }) {
  if (!stats) {
    return null;
  }

  const targets = stats.targets ?? [];
  const hasAnything = targets.length > 0;
  if (!hasAnything) {
    return null;
  }

  const multi = targets.length > 1;

  return (
    <div className="grid gap-1.5">
      {targets.map((target) => {
        const hasCounts =
          target.visitorCount !== null || target.likeCount !== null || target.commentCount !== null || target.forwardCount !== null;
        const key = `${target.qzoneTid}-${target.targetName}`;

        if (target.lastError) {
          return (
            <div
              key={key}
              className="flex gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold leading-5 text-amber-900"
            >
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">
                {multi ? `${target.botName ?? target.targetName}：` : ""}
                {target.lastError}
                {target.checkedAt ? `（${formatFullDateTime(target.checkedAt)}）` : ""}
              </span>
            </div>
          );
        }

        if (!hasCounts) {
          return null;
        }

        return (
          <div key={key} className="rounded-md border border-slate-100 bg-white px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {multi ? (
                <span className="flex min-w-0 items-center gap-1 truncate text-[11px] font-black text-slate-600">
                  <Share2Icon className="size-3 shrink-0 text-slate-400" />
                  {target.botName ?? target.targetName}
                </span>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <QZoneMetricItem icon={EyeIcon} label="浏览" value={target.visitorCount} />
                <QZoneMetricItem icon={HeartIcon} label="点赞" value={target.likeCount} />
                <QZoneMetricItem icon={MessageCircleIcon} label="评论" value={target.commentCount} />
                <QZoneMetricItem icon={Share2Icon} label="转发" value={target.forwardCount} />
              </div>
              {target.checkedAt ? (
                <span className="ml-auto text-[11px] font-semibold text-slate-400">更新 {formatFullDateTime(target.checkedAt)}</span>
              ) : null}
            </div>
            <QZoneCommentsList comments={target.comments ?? []} />
          </div>
        );
      })}
    </div>
  );
}

function QZoneCommentsList({ comments }: { comments: NonNullable<NonNullable<PostItem["qzoneStats"]>["targets"][number]["comments"]> }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (!comments || comments.length === 0) {
    return null;
  }

  const preview = showAll ? comments : comments.slice(0, 3);

  return (
    <div className="mt-2 border-t border-slate-100 pt-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-[11px] font-black text-slate-500 hover:text-slate-700"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <MessageCircleIcon className="size-3 shrink-0" />
        评论 {comments.length}
        <ChevronDownIcon className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <>
          <div className="mt-1.5 grid gap-1.5">
        {preview.map((comment, index) => (
          <div key={`${comment.uin}-${index}`} className="rounded-md bg-slate-50 px-2 py-1.5">
            <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-5">
              <span className="shrink-0 font-black text-slate-700">{comment.name || comment.uin || "匿名"}</span>
              <QQUinTag uin={comment.uin} />
              {comment.createdAt ? <span className="shrink-0 text-[10px] text-slate-400">{formatFullDateTime(comment.createdAt)}</span> : null}
            </p>
            {comment.content ? (
              <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-800">{comment.content}</p>
            ) : comment.images && comment.images.length > 0 ? null : (
              <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-800">（空）</p>
            )}
            <QZoneCommentImages images={comment.images} title={`${comment.name || comment.uin || "匿名"} 的评论图片`} />
            {comment.replies && comment.replies.length > 0 ? (
              <div className="mt-1 grid gap-1 border-l-2 border-slate-200 pl-2">
                {comment.replies.map((reply, replyIndex) => (
                  <div key={`${reply.uin}-${replyIndex}`} className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                      <span className="text-[11px] font-bold text-slate-600">{reply.name || reply.uin || "匿名"}</span>
                      <QQUinTag uin={reply.uin} />
                      <span className="text-[11px] text-slate-400">：</span>
                      <span className="break-words text-[11px] leading-5 text-slate-700">
                        {reply.content || (reply.images && reply.images.length > 0 ? "" : "（空）")}
                      </span>
                    </div>
                    <QZoneCommentImages images={reply.images} title={`${reply.name || reply.uin || "匿名"} 的回复图片`} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
          </div>
          {comments.length > 3 ? (
            <button
              type="button"
              className="mt-1.5 text-[11px] font-bold text-blue-600 hover:underline"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "收起" : `展开全部 ${comments.length} 条`}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function QZoneCommentImages({ images, title = "评论图片" }: { images?: string[] | undefined; title?: string }) {
  const openLightbox = useImageLightbox();
  if (!images || images.length === 0) {
    return null;
  }
  const previewImages: PostImage[] = images.map((src) => ({ url: src }));
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {images.map((src, index) => (
        <button
          key={`${src}-${index}`}
          type="button"
          onClick={() => openLightbox(previewImages, index, title)}
          className="block size-16 overflow-hidden rounded-md border border-slate-200 bg-slate-100 transition hover:ring-2 hover:ring-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          aria-label={`查看${title} ${index + 1}`}
        >
          <img
            src={src}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

function QQUinTag({ uin }: { uin?: string | null }) {
  const value = uin?.trim();
  if (!value) {
    return null;
  }
  async function copyUin() {
    try {
      await navigator.clipboard.writeText(value!);
      toast.success(`已复制 QQ 号 ${value}`);
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  }
  return (
    <button
      type="button"
      onClick={copyUin}
      title="点击复制 QQ 号"
      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[10px] font-bold text-slate-500 transition-colors hover:bg-blue-100 hover:text-blue-600"
    >
      {value}
      <CopyIcon className="size-2.5" />
    </button>
  );
}

function QZoneMetricItem({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | null }) {
  const muted = value === null || value === 0;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={label}>
      <Icon className={`size-3.5 shrink-0 self-center ${muted ? "text-slate-300" : "text-slate-400"}`} />
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      <span className={`text-sm font-black tabular-nums ${muted ? "text-slate-400" : "text-slate-900"}`}>{formatMetricCount(value)}</span>
    </span>
  );
}

function RecallReasonBlock({ reason }: { reason?: string | null }) {
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-900/60 dark:bg-violet-950/30">
      <p className="text-xs font-black text-violet-900 dark:text-violet-100">撤回理由</p>
      <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-6 text-violet-800 dark:text-violet-200">{reason?.trim() || "未填写"}</p>
    </div>
  );
}

function IgnoredRecallBlock({ ignoredAt }: { ignoredAt?: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-black text-slate-700">已忽略</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">这条撤回申请已从顶部固定队列折叠，可继续在这里同意或拒绝。{ignoredAt ? ` 忽略时间：${formatFullDateTime(ignoredAt)}` : ""}</p>
    </div>
  );
}

function InfoPill({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 md:px-2 md:py-1 md:text-xs">
      <Icon className="size-3 md:size-3.5" />
      {children}
    </span>
  );
}

function VisibilityPill({ anonymous, children }: { anonymous: boolean; children: ReactNode }) {
  const Icon = anonymous ? EyeOffIcon : UserIcon;
  const className = anonymous
    ? "border-amber-200 bg-amber-50 text-amber-800 ring-1 ring-amber-200"
    : "border-sky-200 bg-sky-50 text-sky-800 ring-1 ring-sky-200";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-black shadow-none md:gap-1.5 md:px-2.5 md:py-1 md:text-xs ${className}`}>
      <Icon className="size-3 md:size-3.5" />
      {children}
    </span>
  );
}

function ImageGallery({ images, reviewMode = false, compact = false, onImageClick }: { images: PostImage[]; reviewMode?: boolean; compact?: boolean; onImageClick?: (images: PostImage[], index: number) => void }) {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {images.slice(0, 5).map((image, index) => (
          <button
            key={image.key ?? `${image.url}-${index}`}
            type="button"
            className="relative size-12 shrink-0 overflow-hidden rounded-md bg-slate-50 text-left ring-1 ring-slate-200 transition hover:ring-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:size-14"
            onClick={() => onImageClick?.(images, index)}
            aria-label={`查看图片 ${index + 1}`}
          >
            <img src={getPostImageUrl(image)} alt={image.fileName ?? "稿件图片"} className="h-full w-full object-cover" loading="lazy" />
            {index === 4 && images.length > 5 ? <div className="absolute inset-0 grid place-items-center bg-slate-950/45 text-sm font-black text-white">+{images.length - 5}</div> : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`mt-3 grid gap-2 ${reviewMode ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3"}`}>
      {images.slice(0, reviewMode ? 9 : 6).map((image, index) => (
        <button
          key={image.key ?? `${image.url}-${index}`}
          type="button"
          className="relative aspect-square overflow-hidden rounded-md bg-slate-50 text-left ring-1 ring-slate-200 transition hover:ring-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          onClick={() => onImageClick?.(images, index)}
          aria-label={`查看图片 ${index + 1}`}
        >
          <img src={getPostImageUrl(image)} alt={image.fileName ?? "稿件图片"} className="h-full w-full object-cover" loading="lazy" />
          {image.fileName && reviewMode ? (
            <div className="absolute inset-x-0 bottom-0 truncate bg-slate-950/55 px-2 py-1 text-[10px] font-bold text-white">{image.fileName}</div>
          ) : null}
          {index === (reviewMode ? 8 : 5) && images.length > (reviewMode ? 9 : 6) ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/45 text-lg font-black text-white">+{images.length - (reviewMode ? 9 : 6)}</div>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function getPostImages(attachments: unknown): PostImage[] {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments.filter((attachment): attachment is PostImage => typeof attachment === "object" && attachment !== null && "url" in attachment && typeof (attachment as { url: unknown }).url === "string");
}

function getPostImageUrl(image: PostImage) {
  if (image.key) {
    return `/api/uploads/post-image?key=${encodeURIComponent(image.key)}`;
  }

  return image.url ?? "";
}

function formatPostDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMetricCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatFullDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
