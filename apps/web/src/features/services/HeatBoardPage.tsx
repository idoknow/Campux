import { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, ClockIcon, EyeIcon, HashIcon, MessageCircleIcon, Share2Icon, ThumbsUpIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TenantMetadata } from "@/types/app";

type HeatBadge = "boiling" | "hot" | null;

type HeatComment = {
  id: string;
  name: string;
  content: string;
  images: string[];
  createdAt: string | null;
  deleted?: boolean;
};

type HeatAttachment = {
  kind: "image";
  key: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
};

type HeatPost = {
  key: string;
  postId: string | null;
  displayId: number | null;
  title: string;
  text: string;
  attachments?: HeatAttachment[];
  hasImages?: boolean;
  anonymous: boolean;
  author: { displayName: string; qqUin: string } | null;
  heat: number;
  rank?: number;
  badge?: HeatBadge;
  tags: Array<{ id: string; name: string; color: string }>;
  stats: {
    visitorCount: number;
    likeCount: number;
    commentCount: number;
    forwardCount: number;
    targetCount?: number;
    targets?: Array<{ targetName: string; qzoneTid: string; comments?: HeatComment[] }>;
  };
};

type HeatTopic = {
  id: string;
  name: string;
  color: string;
  postCount: number;
  heat: number;
  badge: HeatBadge;
};

type HeatBoardData = {
  updatedAt: string;
  halfLifeHours: number;
  articles: HeatPost[];
  topics: HeatTopic[];
};

type TopicDetail = {
  topic: HeatTopic;
  articles: HeatPost[];
};

function HeatBoardIcon() {
  return (
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="size-6">
      <path d="M512 981.333333a320 320 0 0 1-219.221333-553.088C350.037333 374.357333 490.666667 277.333333 469.333333 64c256 170.666667 384 341.333333 128 597.333333 42.666667 0 106.666667 0 213.333334-105.386666 11.52 32.981333 21.333333 68.437333 21.333333 105.386666A320 320 0 0 1 512 981.333333z" fill="#F64E54" />
    </svg>
  );
}

function BadgeMark({ badge, rank }: { badge?: HeatBadge | undefined; rank?: number | undefined }) {
  if (badge === "boiling") {
    return <span className="inline-flex items-center gap-0.5 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-600"><HeatBoardIcon /><span>沸</span></span>;
  }
  if (badge === "hot") {
    return <span className="inline-flex items-center gap-0.5 rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-black text-orange-600"><HeatBoardIcon /><span>热</span></span>;
  }
  if (typeof rank === "number") {
    return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-slate-100 px-1 text-[10px] font-bold text-slate-500">{rank}</span>;
  }
  return null;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatHeat(value: number) {
  const rounded = Math.round(value * 100) / 100;
  if (rounded >= 1000) return Math.round(rounded).toLocaleString("zh-CN");
  if (rounded >= 10) return rounded.toFixed(1);
  if (rounded >= 1) return rounded.toFixed(2);
  return rounded.toFixed(3);
}

function HeatImageGallery({ images }: { images: Array<{ src: string; alt: string }> }) {
  const [active, setActive] = useState<string | null>(null);
  if (images.length === 0) return null;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {images.map((image, index) => (
          <button key={`${image.src}-${index}`} type="button" className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50" onClick={() => setActive(image.src)}>
            <img src={image.src} alt={image.alt} className="aspect-square w-full object-cover" />
          </button>
        ))}
      </div>
      <Dialog open={active !== null} onOpenChange={(next) => { if (!next) setActive(null); }}>
        <DialogContent className="max-w-[min(820px,calc(100vw-24px))] p-0">
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          {active ? <img src={active} alt="图片预览" className="max-h-[80vh] w-full rounded-2xl bg-slate-950 object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PostDialog({ post, open, onClose }: { post: HeatPost | null; open: boolean; onClose: () => void }) {
  const comments = (post?.stats.targets ?? []).flatMap((target) => target.comments ?? []).filter((comment) => !comment.deleted);
  const images = [
    ...(post?.attachments ?? []).filter((attachment) => attachment.contentType.startsWith("image/")).map((attachment) => ({ src: attachment.url, alt: attachment.fileName || `附件图片 ${attachment.key}` })),
    ...comments.flatMap((comment) => comment.images.map((src, index) => ({ src, alt: `${comment.name || "评论"}图片 ${index + 1}` }))),
  ];
  return (
    <Dialog open={open && post !== null} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[86vh] w-[min(560px,calc(100vw-32px))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>稿件详情</DialogTitle>
        </DialogHeader>
        {post ? (
          <div className="space-y-3 px-5 pb-5">
            <div className="flex flex-wrap items-center gap-2">
              {post.displayId !== null ? <span className="text-xs font-semibold text-slate-400">#{post.displayId}</span> : null}
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-600">热度 {formatHeat(post.heat)}</span>
              {post.tags.map((tag) => (
                <span key={tag.id} className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: tag.color, color: "#334155" }}>#{tag.name}</span>
              ))}
            </div>
            <p className="white-space:break-words rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-800">{post.text}</p>
            <div className="grid grid-cols-4 gap-2 text-center text-xs text-slate-500">
              <span className="rounded-lg border border-slate-100 p-2"><EyeIcon className="mx-auto size-3.5" />{post.stats.visitorCount}</span>
              <span className="rounded-lg border border-slate-100 p-2"><ThumbsUpIcon className="mx-auto size-3.5" />{post.stats.likeCount}</span>
              <span className="rounded-lg border border-slate-100 p-2"><MessageCircleIcon className="mx-auto size-3.5" />{post.stats.commentCount}</span>
              <span className="rounded-lg border border-slate-100 p-2"><Share2Icon className="mx-auto size-3.5" />{post.stats.forwardCount}</span>
            </div>
            {images.length > 0 ? <HeatImageGallery images={images} /> : null}
            <div>
              <p className="mb-2 text-xs font-bold text-slate-500">评论 {comments.length > 0 ? `(${comments.length})` : ""}</p>
              {comments.length > 0 ? (
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {comments.map((comment, index) => (
                    <div key={comment.id || index} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{comment.name || "匿名用户"}</span>
                        {comment.createdAt ? <span className="text-slate-400">{formatTime(comment.createdAt)}</span> : null}
                      </div>
                      {comment.content ? <p className="mt-1 break-words text-xs leading-5 text-slate-600">{comment.content}</p> : null}
                    </div>
                  ))}
                </div>
              ) : <p className="py-3 text-center text-xs text-slate-400">暂无同步评论。</p>}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function HeatBoardPage({ metadata }: { metadata: TenantMetadata }) {
  const [tab, setTab] = useState<"articles" | "topics">("articles");
  const [data, setData] = useState<HeatBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [topicPosts, setTopicPosts] = useState<Record<string, HeatPost[]>>({});
  const [selectedPost, setSelectedPost] = useState<HeatPost | null>(null);
  const [postDialogOpen, setPostDialogOpen] = useState(false);

  function reload() {
    setLoading(true);
    api<HeatBoardData>("/api/heat-board")
      .then(setData)
      .catch((caught) => toast.error(caught instanceof Error ? caught.message : "热榜加载失败"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  async function toggleTopic(topic: HeatTopic) {
    if (expandedTopicId === topic.id) {
      setExpandedTopicId(null);
      return;
    }
    setExpandedTopicId(topic.id);
    if (!topicPosts[topic.id]) {
      try {
        const detail = await api<TopicDetail>(`/api/heat-board/topic?topicId=${encodeURIComponent(topic.id)}`);
        setTopicPosts((current) => ({ ...current, [topic.id]: detail.articles }));
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "话题稿件加载失败");
      }
    }
  }

  function openPost(post: HeatPost) {
    setSelectedPost(post);
    setPostDialogOpen(true);
  }

  function articleRows() {
    if (!data || data.articles.length === 0) {
      return <p className="py-10 text-center text-sm text-slate-500">暂无上榜稿件。</p>;
    }
    return data.articles.map((post) => (
      <button key={post.key} onClick={() => openPost(post)} className="grid w-full grid-cols-[1fr_auto] gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-rose-200 hover:shadow">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5">
            <BadgeMark badge={post.badge} rank={post.rank} />
            <span className="truncate text-xs text-slate-400">{post.anonymous ? "匿名" : (post.author?.displayName || "未知")}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 text-slate-900">{post.title}</p>
            {post.hasImages ? <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-600">图</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><EyeIcon className="size-3" />{post.stats.visitorCount}</span>
            <span className="flex items-center gap-1"><ThumbsUpIcon className="size-3" />{post.stats.likeCount}</span>
            <span className="flex items-center gap-1"><MessageCircleIcon className="size-3" />{post.stats.commentCount}</span>
            <span className="flex items-center gap-1"><Share2Icon className="size-3" />{post.stats.forwardCount}</span>
          </div>
        </div>
        <div className="flex flex-col items-end justify-between">
          <span className="text-sm font-black text-rose-500">{formatHeat(post.heat)}</span>
          <span className="text-[10px] text-slate-300">HEAT</span>
        </div>
      </button>
    ));
  }

  function topicRows() {
    if (!data || data.topics.length === 0) {
      return <p className="py-10 text-center text-sm text-slate-500">暂无话题。</p>;
    }
    return data.topics.map((topic) => (
      <div key={topic.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => void toggleTopic(topic)}>
          <BadgeMark badge={topic.badge} />
          <HashIcon className="size-4 shrink-0 text-indigo-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">#{topic.name}</span>
            <span className="block text-xs text-slate-500">{topic.postCount} 篇稿件</span>
          </span>
          <span className="text-sm font-black text-rose-500">{formatHeat(topic.heat)}</span>
          {expandedTopicId === topic.id ? <ChevronDownIcon className="size-4 text-slate-400" /> : <ChevronRightIcon className="size-4 text-slate-400" />}
        </button>
        {expandedTopicId === topic.id ? (
          <div className="space-y-2 border-t border-slate-100 p-2">
            {(topicPosts[topic.id] ?? []).length ? (topicPosts[topic.id] ?? []).map((post) => (
              <div key={post.key} className="rounded-lg border border-slate-100 bg-slate-50/60">
                <button className="flex w-full items-center gap-2 p-2 text-left" onClick={() => openPost(post)}>
                  <BadgeMark badge={post.badge} rank={post.rank} />
                  <span className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium text-slate-700"><span className="truncate">{post.title}</span>{post.hasImages ? <span className="shrink-0 rounded bg-sky-50 px-1 py-0.5 text-[10px] font-black text-sky-600">图</span> : null}</span>
                  <span className="shrink-0 text-xs font-bold text-rose-500">{formatHeat(post.heat)}</span>
                </button>
              </div>
            )) : <p className="py-4 text-center text-xs text-slate-500">正在加载话题稿件…</p>}
          </div>
        ) : null}
      </div>
    ));
  }

  if (!metadata.enableHeatBoard) {
    return <section className="product-surface p-4 text-sm text-slate-500">热度榜插件尚未启用。</section>;
  }

  return (
    <section className="product-surface h-full min-h-0 overflow-y-auto overscroll-contain px-4 py-4 pb-24 md:pb-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-rose-50"><HeatBoardIcon /></span>
          <div>
            <h2 className="text-sm font-semibold text-slate-950">热度榜</h2>
            <p className="text-xs text-slate-500">单篇最多话题 {metadata.heatBoardMaxTagCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <span className="flex items-center gap-1 text-xs text-slate-400"><ClockIcon className="size-3.5" />{data ? `更新 ${formatTime(data.updatedAt)}` : "加载中"}</span>
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>{loading ? "刷新中" : "刷新"}</Button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 text-xs">
        <button className={`flex-1 rounded-full px-3 py-1.5 font-semibold ${tab === "articles" ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => setTab("articles")}>稿件排行榜</button>
        <button className={`flex-1 rounded-full px-3 py-1.5 font-semibold ${tab === "topics" ? "bg-slate-900 text-white" : "text-slate-600"}`} onClick={() => setTab("topics")}>话题排行榜</button>
      </div>

      <div className="mt-3 space-y-2">
        {loading && !data ? <p className="py-10 text-center text-sm text-slate-500">正在计算热度…</p> : null}
        {tab === "articles" ? articleRows() : topicRows()}
      </div>
      <PostDialog post={selectedPost} open={postDialogOpen} onClose={() => setPostDialogOpen(false)} />
    </section>
  );
}
