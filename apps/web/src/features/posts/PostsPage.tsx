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
  SparklesIcon,
  UserIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PostItem, PostsTab, ReviewPostItem, TenantRole } from "@/types/app";
import { canAccess, statusLabels } from "@/lib/app-model";
import { EmptyCard } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

export function PostsPage({
  posts,
  currentRole,
  activeTab,
  onTabChange,
  onRefresh,
}: {
  posts: PostItem[];
  currentRole: TenantRole;
  activeTab: PostsTab;
  onTabChange: (tab: PostsTab) => void;
  onRefresh: () => Promise<void>;
}) {
  const canReview = canAccess(currentRole, "reviewer");
  const [reviewPosts, setReviewPosts] = useState<ReviewPostItem[]>([]);
  const [reviewStatus, setReviewStatus] = useState("pending_approval");
  const [reviewKeyword, setReviewKeyword] = useState("");
  const [busyPostId, setBusyPostId] = useState("");
  const [preview, setPreview] = useState<RenderPreviewState>(() => ({
    open: false,
    loading: false,
    error: "",
    url: "",
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

    void refreshReviewPosts().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取审核列表");
    });
  }, [canReview, reviewStatus]);

  async function refreshAll() {
    await onRefresh();
    if (canReview) {
      await refreshReviewPosts();
    }
  }

  async function refreshReviewPosts() {
    const params = new URLSearchParams({
      status: reviewStatus,
    });
    const keyword = reviewKeyword.trim();
    if (keyword.length > 0) {
      params.set("q", keyword);
    }
    const data = await api<{ posts: ReviewPostItem[] }>(`/api/review/posts?${params}`);
    setReviewPosts(data.posts);
  }

  async function reviewPost(id: string, action: "approve" | "reject") {
    setBusyPostId(id);
    try {
      await api(`/api/review/posts/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success(action === "approve" ? "已通过，正在生成发布任务。" : "已拒绝。");
      await refreshAll();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "审核失败");
    } finally {
      setBusyPostId("");
    }
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
          <Button variant="outline" size="sm" onClick={() => void refreshAll()}>
            刷新
          </Button>
        </div>
        <TabsContent value="mine" className="mt-3 min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
          <PostList posts={posts} onPreview={(post) => void openRenderPreview(post)} />
        </TabsContent>
        {canReview ? (
          <TabsContent value="review" className="mt-3 flex min-h-0 flex-1 flex-col">
            <div className="product-subsection mb-3 grid gap-2 p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
              <Select value={reviewStatus} onValueChange={setReviewStatus}>
                <SelectTrigger className="h-10 w-full bg-white font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending_approval">待审核</SelectItem>
                  <SelectItem value="approved">已通过</SelectItem>
                  <SelectItem value="rejected">已拒绝</SelectItem>
                  <SelectItem value="publishing">发布中</SelectItem>
                  <SelectItem value="published">已发布</SelectItem>
                  <SelectItem value="failed">发布失败</SelectItem>
                  <SelectItem value="all">全部</SelectItem>
                </SelectContent>
              </Select>
              <input
                value={reviewKeyword}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:border-slate-400"
                placeholder="按内容或编号搜索"
                onChange={(event) => setReviewKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void refreshReviewPosts();
                  }
                }}
              />
              <Button variant="outline" className="h-10 font-bold" onClick={() => void refreshReviewPosts()}>
                筛选
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
              <ReviewList
                posts={reviewPosts}
                busyPostId={busyPostId}
                onPreview={(post) => void openRenderPreview(post)}
                onApprove={(id) => void reviewPost(id, "approve")}
                onReject={(id) => void reviewPost(id, "reject")}
              />
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
    </div>
  );
}

function ReviewList({
  posts,
  busyPostId,
  onPreview,
  onApprove,
  onReject,
}: {
  posts: ReviewPostItem[];
  busyPostId: string;
  onPreview: (post: ReviewPostItem) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
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
          onApprove={() => onApprove(post.id)}
          onReject={() => onReject(post.id)}
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
  onApprove,
  onReject,
}: {
  post: ReviewPostItem;
  palette: string;
  busy: boolean;
  onPreview: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const images = getPostImages(post.images);
  const authorName = post.author?.displayName ?? "未命名用户";
  const authorQq = post.author?.qqUin ?? "未知 QQ";
  const statusClassName = statusStyles[post.status] ?? "bg-white text-slate-600";

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

        {images.length > 0 ? <ImageGallery images={images} reviewMode /> : <NoImagePill />}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
            <span className="break-all">内部 ID：{shortId(post.id)}</span>
            <span>创建：{formatFullDateTime(post.createdAt)}</span>
          </div>
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
        </div>
      </CardContent>
    </Card>
  );
}

function PostList({ posts, onPreview }: { posts: PostItem[]; onPreview: (post: PostItem) => void }) {
  if (posts.length === 0) {
    return <EmptyCard title="还没有稿件，先去投一条吧" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((post, index) => (
        <PostCard key={post.id} post={post} palette={postCardPalettes[index % postCardPalettes.length] ?? defaultPostCardPalette} onPreview={() => onPreview(post)} />
      ))}
    </div>
  );
}

function PostCard({ post, palette, onPreview }: { post: PostItem; palette: string; onPreview: () => void }) {
  const images = getPostImages(post.images);
  const statusClassName = statusStyles[post.status] ?? "bg-white text-slate-600";

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
          actions={<PreviewButton onClick={onPreview} />}
        />

        <PostTextBlock text={post.text} createdAt={post.createdAt} />

        {images.length > 0 ? <ImageGallery images={images} /> : <NoImagePill />}

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

function ImageGallery({ images, reviewMode = false }: { images: PostImage[]; reviewMode?: boolean }) {
  return (
    <div className={`mt-3 grid gap-2 ${reviewMode ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3"}`}>
      {images.slice(0, reviewMode ? 9 : 6).map((image, index) => (
        <div key={image.key ?? `${image.url}-${index}`} className="relative aspect-square overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200">
          <img src={getPostImageUrl(image)} alt={image.fileName ?? "稿件图片"} className="h-full w-full object-cover" loading="lazy" />
          {image.fileName && reviewMode ? (
            <div className="absolute inset-x-0 bottom-0 truncate bg-slate-950/55 px-2 py-1 text-[10px] font-bold text-white">{image.fileName}</div>
          ) : null}
          {index === (reviewMode ? 8 : 5) && images.length > (reviewMode ? 9 : 6) ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-950/45 text-lg font-black text-white">+{images.length - (reviewMode ? 9 : 6)}</div>
          ) : null}
        </div>
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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
