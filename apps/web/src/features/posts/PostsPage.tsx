import { useEffect, useState } from "react";
import { CameraIcon, CheckIcon, EyeOffIcon, HashIcon, RefreshCwIcon, SparklesIcon, UserIcon, XIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { PostItem, ReviewPostItem, TenantRole } from "@/types/app";
import { canAccess, statusLabels } from "@/lib/app-model";
import { EmptyCard, SectionHeader } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PostImage = {
  key?: string;
  url?: string;
  fileName?: string;
};

const postCardPalettes = [
  "border-[#ffd596] bg-[#fff8e8]",
  "border-[#bceaff] bg-[#eefaff]",
  "border-[#d2efb9] bg-[#f4ffe9]",
  "border-[#ffc9d6] bg-[#fff0f4]",
];
const defaultPostCardPalette = "border-[#ffd596] bg-[#fff8e8]";

const statusStyles: Record<string, string> = {
  pending_approval: "bg-[#ffb94d] text-white",
  approved: "bg-[#8bc34a] text-white",
  rejected: "bg-[#ff7d68] text-white",
  published: "bg-[#42a5f5] text-white",
};

export function PostsPage({
  posts,
  currentRole,
  onRefresh,
}: {
  posts: PostItem[];
  currentRole: TenantRole;
  onRefresh: () => Promise<void>;
}) {
  const canReview = canAccess(currentRole, "reviewer");
  const [reviewPosts, setReviewPosts] = useState<ReviewPostItem[]>([]);
  const [reviewError, setReviewError] = useState("");
  const [busyPostId, setBusyPostId] = useState("");

  useEffect(() => {
    if (!canReview) {
      setReviewPosts([]);
      return;
    }

    void refreshReviewPosts().catch((caught) => {
      setReviewError(caught instanceof Error ? caught.message : "无法读取审核列表");
    });
  }, [canReview]);

  async function refreshAll() {
    await onRefresh();
    if (canReview) {
      await refreshReviewPosts();
    }
  }

  async function refreshReviewPosts() {
    const data = await api<{ posts: ReviewPostItem[] }>("/api/review/posts");
    setReviewPosts(data.posts);
    setReviewError("");
  }

  async function reviewPost(id: string, action: "approve" | "reject") {
    setBusyPostId(id);
    setReviewError("");
    try {
      await api(`/api/review/posts/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refreshAll();
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : "审核失败");
    } finally {
      setBusyPostId("");
    }
  }

  return (
    <div className="px-4">
      <SectionHeader title="稿件" subtitle="看看你的投稿进度" action="刷新" icon={RefreshCwIcon} onAction={refreshAll} />
      <Tabs defaultValue="mine" className="mt-3">
        <TabsList className={`grid h-14 w-full items-stretch rounded-md bg-[#eef8ff] p-1.5 shadow-none ${canReview ? "grid-cols-3" : "grid-cols-2"}`}>
          <TabsTrigger value="mine" className="h-full rounded-[6px] p-0 text-base font-bold shadow-none after:hidden data-active:bg-[#42a5f5] data-active:text-white data-active:shadow-none">
            你的稿件
          </TabsTrigger>
          <TabsTrigger value="feed" className="h-full rounded-[6px] p-0 text-base font-bold shadow-none after:hidden data-active:bg-[#8bc34a] data-active:text-white data-active:shadow-none">
            动态
          </TabsTrigger>
          {canReview ? (
            <TabsTrigger value="review" className="h-full rounded-[6px] p-0 text-base font-bold shadow-none after:hidden data-active:bg-[#f8b94c] data-active:text-white data-active:shadow-none">
              审核
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="mine" className="mt-3">
          <PostList posts={posts} />
        </TabsContent>
        <TabsContent value="feed" className="mt-3">
          <EmptyCard title="前面的区域，以后再来探索吧" />
        </TabsContent>
        {canReview ? (
          <TabsContent value="review" className="mt-3">
            {reviewError ? <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{reviewError}</p> : null}
            <ReviewList posts={reviewPosts} busyPostId={busyPostId} onApprove={(id) => void reviewPost(id, "approve")} onReject={(id) => void reviewPost(id, "reject")} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function ReviewList({
  posts,
  busyPostId,
  onApprove,
  onReject,
}: {
  posts: ReviewPostItem[];
  busyPostId: string;
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
  onApprove,
  onReject,
}: {
  post: ReviewPostItem;
  palette: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const images = getPostImages(post.images);

  return (
    <Card className={`overflow-hidden rounded-md border shadow-none ${palette}`}>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-1 text-xs font-black text-slate-700">
            <HashIcon className="size-3" />
            {post.displayId}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-1 text-xs font-black text-slate-700">
            {post.anonymous ? <EyeOffIcon className="size-3" /> : <UserIcon className="size-3" />}
            {post.anonymous ? "匿名投稿" : post.author?.displayName ?? post.author?.qqUin ?? "实名投稿"}
          </span>
          <Badge className="rounded-full bg-[#ffb94d] text-white shadow-none">待审核</Badge>
        </div>

        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.text}</p>

        {images.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {images.slice(0, 6).map((image, index) => (
              <div key={image.key ?? `${image.url}-${index}`} className="relative aspect-square overflow-hidden rounded-[6px] bg-white/70">
                <img src={image.url} alt={image.fileName ?? "稿件图片"} className="h-full w-full object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-slate-500">{formatPostDate(post.createdAt)}</span>
          <div className="flex gap-2">
            <Button size="sm" className="bg-[#8bc34a] font-bold hover:bg-[#8bc34a]" disabled={busy} onClick={onApprove}>
              <CheckIcon data-icon="inline-start" />
              通过
            </Button>
            <Button size="sm" variant="outline" className="font-bold" disabled={busy} onClick={onReject}>
              <XIcon data-icon="inline-start" />
              拒绝
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PostList({ posts }: { posts: PostItem[] }) {
  if (posts.length === 0) {
    return <EmptyCard title="还没有稿件，先去投一条吧" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((post, index) => (
        <PostCard key={post.id} post={post} palette={postCardPalettes[index % postCardPalettes.length] ?? defaultPostCardPalette} />
      ))}
    </div>
  );
}

function PostCard({ post, palette }: { post: PostItem; palette: string }) {
  const images = getPostImages(post.images);
  const statusClassName = statusStyles[post.status] ?? "bg-white text-slate-600";

  return (
    <Card className={`overflow-hidden rounded-md border shadow-none ${palette}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-1 text-xs font-black text-slate-700">
                <HashIcon className="size-3" />
                {post.displayId}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-1 text-xs font-black text-slate-700">
                {post.anonymous ? <EyeOffIcon className="size-3" /> : <UserIcon className="size-3" />}
                {post.anonymous ? "匿名投稿" : "实名投稿"}
              </span>
            </div>
            <h3 className="mt-2 truncate text-lg font-black text-slate-950">{post.title || "未命名稿件"}</h3>
          </div>
          <Badge className={`shrink-0 rounded-full px-2.5 py-1 shadow-none ${statusClassName}`}>{statusLabels[post.status] ?? post.status}</Badge>
        </div>

        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.text}</p>

        {images.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {images.slice(0, 6).map((image, index) => (
              <div key={image.key ?? `${image.url}-${index}`} className="relative aspect-square overflow-hidden rounded-[6px] bg-white/70">
                <img src={image.url} alt={image.fileName ?? "稿件图片"} className="h-full w-full object-cover" loading="lazy" />
                {index === 5 && images.length > 6 ? (
                  <div className="absolute inset-0 grid place-items-center bg-slate-950/45 text-lg font-black text-white">+{images.length - 6}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-xs font-bold text-slate-500">
            <CameraIcon className="size-3.5" />
            没有配图
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-500">
          <span>{formatPostDate(post.createdAt)}</span>
          <span className="inline-flex items-center gap-1 text-sky-600">
            <SparklesIcon className="size-3.5" />
            {post.status === "published" ? "已出现在墙上" : "等待下一步"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function getPostImages(images: unknown): PostImage[] {
  if (!Array.isArray(images)) {
    return [];
  }

  return images.filter((image): image is PostImage => typeof image === "object" && image !== null && "url" in image && typeof image.url === "string");
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
