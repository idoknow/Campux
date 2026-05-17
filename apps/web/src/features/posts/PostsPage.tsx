import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CameraIcon,
  CheckIcon,
  ClockIcon,
  EyeOffIcon,
  FileTextIcon,
  HashIcon,
  ImageIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Pagination, PostItem, PostsTab, ReviewPostItem, TenantRole } from "@/types/app";
import { canAccess, statusLabels } from "@/lib/app-model";
import { EmptyCard, LoadingBlock, PaginationControls } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type PostImage = {
  key?: string;
  url?: string;
  fileName?: string;
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

type ImagePreviewState = {
  open: boolean;
  images: PostImage[];
  index: number;
  title: string;
};

const postCardPalettes = [
  "border-slate-200 bg-white",
  "border-slate-200 bg-white",
  "border-slate-200 bg-white",
  "border-slate-200 bg-white",
];
const defaultPostCardPalette = "border-slate-200 bg-white";

const statusStyles: Record<string, string> = {
  pending_approval: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  approved: "bg-green-50 text-green-800 ring-1 ring-green-200",
  rejected: "bg-red-50 text-red-700 ring-1 ring-red-200",
  published: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
};

const postTabsListClassName = "product-tabs-list";
const postTabsTriggerClassName = "product-tabs-trigger after:hidden";
const reviewStatusOptions = [
  { value: "pending_approval", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
  { value: "publishing", label: "发布中" },
  { value: "published", label: "已发布" },
  { value: "failed", label: "发布失败" },
  { value: "all", label: "全部" },
];

export function PostsPage({
  tenantId,
  posts,
  currentRole,
  activeTab,
  minePagination,
  mineLoading,
  onMinePageChange,
  onTabChange,
  onRefresh,
}: {
  tenantId: string;
  posts: PostItem[];
  currentRole: TenantRole;
  activeTab: PostsTab;
  minePagination: Pagination;
  mineLoading: boolean;
  onMinePageChange: (page: number) => void;
  onTabChange: (tab: PostsTab) => void;
  onRefresh: () => Promise<void>;
}) {
  const canReview = canAccess(currentRole, "reviewer");
  const [reviewPosts, setReviewPosts] = useState<ReviewPostItem[]>([]);
  const [reviewPagination, setReviewPagination] = useState<Pagination>(() => defaultPagination());
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewStatus, setReviewStatus] = useState("pending_approval");
  const [reviewKeyword, setReviewKeyword] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [busyPostId, setBusyPostId] = useState("");
  const [busyCancelPostId, setBusyCancelPostId] = useState("");
  const [rejectDialog, setRejectDialog] = useState<RejectDialogState>(() => ({
    open: false,
    postId: "",
    displayId: null,
    reason: "",
  }));
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
    if (!canReview && activeTab !== "mine") {
      onTabChange("mine");
    }
  }, [activeTab, canReview, onTabChange]);

  useEffect(() => {
    if (!canReview) {
      setReviewPosts([]);
      return;
    }

    setReviewPosts([]);
    void refreshReviewPosts(reviewPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取审核列表");
    });
  }, [canReview, reviewStatus, reviewPage, tenantId]);

  async function refreshAll() {
    await onRefresh();
    if (canReview) {
      await refreshReviewPosts(reviewPage);
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

  async function cancelPost(id: string) {
    setBusyCancelPostId(id);
    try {
      await api(`/api/posts/${id}/cancel`, {
        method: "POST",
      });
      toast.success("已取消稿件，并通知审核群。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "取消失败");
    } finally {
      setBusyCancelPostId("");
    }
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
    await reviewPost(rejectDialog.postId, "reject", "无理由");
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

  function applyReviewFilters() {
    setReviewPage(1);
    void refreshReviewPosts(1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pt-4">
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as PostsTab)} className="min-h-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <TabsList className={postTabsListClassName}>
            <TabsTrigger value="mine" className={postTabsTriggerClassName}>
              你的稿件
            </TabsTrigger>
            {canReview ? (
              <TabsTrigger value="review" className={postTabsTriggerClassName}>
                审核
              </TabsTrigger>
            ) : null}
          </TabsList>
          <Button variant="outline" size="sm" disabled={mineLoading || reviewLoading} onClick={() => void refreshAll()}>
            刷新
          </Button>
        </div>
        <TabsContent value="mine" className="mt-3 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
          {mineLoading ? (
            <LoadingBlock title="正在加载你的稿件..." />
          ) : (
            <>
              <PostList
                posts={posts}
                busyCancelPostId={busyCancelPostId}
                onPreview={(post) => void openRenderPreview(post)}
                onImagePreview={(post, images, index) => openImagePreview(images, index, `稿件 ${post.displayId} 上传图片`)}
                onCancel={(post) => void cancelPost(post.id)}
              />
              <PaginationControls pagination={minePagination} busy={mineLoading} onPageChange={onMinePageChange} />
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
                  <span className="min-w-0 truncate text-xs font-medium text-slate-500">{reviewKeyword.trim() ? reviewKeyword.trim() : "全部内容"}</span>
                </span>
                <SearchIcon className="size-4 shrink-0 text-slate-400" />
              </button>
            </div>
            <div className="product-subsection mb-3 hidden gap-2 p-3 md:grid md:grid-cols-[160px_minmax(0,1fr)_auto]">
              <Select value={reviewStatus} onValueChange={(value) => {
                setReviewStatus(value);
                setReviewPage(1);
              }}>
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
            <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              {reviewLoading ? (
                <LoadingBlock title="正在加载审核稿件..." />
              ) : (
                <>
                  <ReviewList
                    posts={reviewPosts}
                    busyPostId={busyPostId}
                    onPreview={(post) => void openRenderPreview(post)}
                    onImagePreview={(post, images, index) => openImagePreview(images, index, `稿件 ${post.displayId} 上传图片`)}
                    onApprove={(id) => void reviewPost(id, "approve")}
                    onReject={(post) => setRejectDialog({ open: true, postId: post.id, displayId: post.displayId, reason: "" })}
                  />
                  <PaginationControls pagination={reviewPagination} busy={reviewLoading} onPageChange={setReviewPage} />
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
              <Select value={reviewStatus} onValueChange={(value) => {
                setReviewStatus(value);
                setReviewPage(1);
              }}>
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
                无理由拒绝
              </Button>
              <Button disabled={busyPostId === rejectDialog.postId || rejectDialog.reason.trim().length === 0} onClick={() => void submitReject()}>
                确认拒绝
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
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

function ReviewList({
  posts,
  busyPostId,
  onPreview,
  onImagePreview,
  onApprove,
  onReject,
}: {
  posts: ReviewPostItem[];
  busyPostId: string;
  onPreview: (post: ReviewPostItem) => void;
  onImagePreview: (post: ReviewPostItem, images: PostImage[], index: number) => void;
  onApprove: (id: string) => void;
  onReject: (post: ReviewPostItem) => void;
}) {
  if (posts.length === 0) {
    return <EmptyCard title="暂时没有待审核稿件" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((post, index) => (
        <ReviewCard
          key={post.id}
          post={post}
          palette={postCardPalettes[index % postCardPalettes.length] ?? defaultPostCardPalette}
          busy={busyPostId === post.id}
          onPreview={() => onPreview(post)}
          onImagePreview={(images, imageIndex) => onImagePreview(post, images, imageIndex)}
          onApprove={() => onApprove(post.id)}
          onReject={() => onReject(post)}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  post,
  palette,
  busy,
  onPreview,
  onImagePreview,
  onApprove,
  onReject,
}: {
  post: ReviewPostItem;
  palette: string;
  busy: boolean;
  onPreview: () => void;
  onImagePreview: (images: PostImage[], index: number) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const images = getPostImages(post.images);
  const authorName = post.author?.displayName ?? "未命名用户";
  const authorQq = post.author?.qqUin ?? "未知 QQ";
  const statusClassName = statusStyles[post.status] ?? "bg-white text-slate-600";
  const canReviewPost = post.status === "pending_approval";

  return (
    <Card className={`overflow-hidden rounded-md border shadow-none ${palette}`}>
      <CardContent className="grid gap-3 p-3">
        <PostMetaHeader
          displayId={`稿件 ${post.displayId}`}
          anonymous={post.anonymous}
          anonymousLabel={post.anonymous ? "前台匿名" : "前台实名"}
          imageCount={images.length}
          status={post.status}
          statusClassName={statusClassName}
          actions={<PreviewButton onClick={onPreview} />}
        />

        <div className="product-subsection p-3">
          <div className="flex items-start gap-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200">
              <UserRoundIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-950">{authorName}</p>
                <Badge className="rounded-full bg-white text-slate-600 ring-1 ring-slate-200 shadow-none">QQ {authorQq}</Badge>
              </div>
              <p className="mt-1 break-all text-xs font-bold text-slate-500">账号 ID：{post.author?.id ?? "未知"}</p>
            </div>
          </div>
        </div>

        <PostTextBlock text={post.text} createdAt={post.createdAt} updatedAt={post.updatedAt} />

        {images.length > 0 ? <ImageGallery images={images} reviewMode onImageClick={onImagePreview} /> : <NoImagePill />}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
            <span className="break-all">内部 ID：{shortId(post.id)}</span>
            <span>创建：{formatFullDateTime(post.createdAt)}</span>
          </div>
          {canReviewPost ? (
            <div className="flex gap-2">
              <Button size="sm" className="font-medium" disabled={busy} onClick={onApprove}>
                <CheckIcon data-icon="inline-start" />
                通过
              </Button>
              <Button size="sm" variant="outline" className="font-medium" disabled={busy} onClick={onReject}>
                <XIcon data-icon="inline-start" />
                拒绝
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
  onPreview,
  onImagePreview,
  onCancel,
}: {
  posts: PostItem[];
  busyCancelPostId: string;
  onPreview: (post: PostItem) => void;
  onImagePreview: (post: PostItem, images: PostImage[], index: number) => void;
  onCancel: (post: PostItem) => void;
}) {
  if (posts.length === 0) {
    return <EmptyCard title="还没有稿件，先去投一条吧" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((post, index) => (
        <PostCard
          key={post.id}
          post={post}
          palette={postCardPalettes[index % postCardPalettes.length] ?? defaultPostCardPalette}
          cancelBusy={busyCancelPostId === post.id}
          onPreview={() => onPreview(post)}
          onImagePreview={(images, imageIndex) => onImagePreview(post, images, imageIndex)}
          onCancel={() => onCancel(post)}
        />
      ))}
    </div>
  );
}

function PostCard({
  post,
  palette,
  cancelBusy,
  onPreview,
  onImagePreview,
  onCancel,
}: {
  post: PostItem;
  palette: string;
  cancelBusy: boolean;
  onPreview: () => void;
  onImagePreview: (images: PostImage[], index: number) => void;
  onCancel: () => void;
}) {
  const images = getPostImages(post.images);
  const statusClassName = statusStyles[post.status] ?? "bg-white text-slate-600";
  const canCancel = post.status === "pending_approval";

  return (
    <Card className={`overflow-hidden rounded-md border shadow-none ${palette}`}>
      <CardContent className="grid gap-3 p-3">
        <PostMetaHeader
          displayId={post.displayId}
          anonymous={post.anonymous}
          anonymousLabel={post.anonymous ? "匿名投稿" : "实名投稿"}
          imageCount={images.length}
          status={post.status}
          statusClassName={statusClassName}
          title={post.title || "未命名稿件"}
          actions={
            <>
              <PreviewButton onClick={onPreview} />
              {canCancel ? <CancelButton busy={cancelBusy} onClick={onCancel} /> : null}
            </>
          }
        />

        <PostTextBlock text={post.text} createdAt={post.createdAt} />

        {images.length > 0 ? <ImageGallery images={images} onImageClick={onImagePreview} /> : <NoImagePill />}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3.5" />
            {formatPostDate(post.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <SparklesIcon className="size-3.5" />
            {post.status === "published" ? "已出现在墙上" : "等待下一步"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PostMetaHeader({
  displayId,
  anonymous,
  anonymousLabel,
  imageCount,
  status,
  statusClassName,
  title,
  actions,
}: {
  displayId: string | number;
  anonymous: boolean;
  anonymousLabel: string;
  imageCount: number;
  status: string;
  statusClassName: string;
  title?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <InfoPill icon={HashIcon}>{displayId}</InfoPill>
          <InfoPill icon={anonymous ? EyeOffIcon : UserIcon}>{anonymousLabel}</InfoPill>
          <InfoPill icon={ImageIcon}>{imageCount} 张图</InfoPill>
        </div>
        {title ? <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-6 text-slate-950">{title}</h3> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
        <Badge className={`rounded-full px-2.5 py-1 text-xs font-semibold shadow-none ${statusClassName}`}>{statusLabels[status] ?? status}</Badge>
      </div>
    </div>
  );
}

function PreviewButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="h-8 px-2 text-xs font-bold" onClick={onClick}>
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

function PostTextBlock({ text, createdAt, updatedAt }: { text: string; createdAt: string; updatedAt?: string }) {
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
      <p className="whitespace-pre-wrap text-[15px] font-medium leading-7 text-slate-800">{text}</p>
    </div>
  );
}

function InfoPill({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}

function NoImagePill() {
  return (
    <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-500">
      <CameraIcon className="size-3.5" />
      没有配图
    </div>
  );
}

function ImageGallery({ images, reviewMode = false, onImageClick }: { images: PostImage[]; reviewMode?: boolean; onImageClick?: (images: PostImage[], index: number) => void }) {
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

function getPostImages(images: unknown): PostImage[] {
  if (!Array.isArray(images)) {
    return [];
  }

  return images.filter((image): image is PostImage => typeof image === "object" && image !== null && "url" in image && typeof image.url === "string");
}

function getPostImageUrl(image: PostImage) {
  if (image.key) {
    return `/api/uploads/post-image?key=${encodeURIComponent(image.key)}`;
  }

  return image.url ?? "";
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
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
