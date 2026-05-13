import { RefreshCwIcon } from "lucide-react";
import type { PostItem, TenantRole } from "@/types/app";
import { canAccess, statusLabels } from "@/lib/app-model";
import { EmptyCard, SectionHeader } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  return (
    <div className="px-4">
      <SectionHeader title="稿件" subtitle="你的稿件、动态和审核流" action="刷新" icon={RefreshCwIcon} onAction={onRefresh} />
      <Tabs defaultValue="mine" className="mt-3">
        <TabsList className={`grid w-full ${canReview ? "grid-cols-3" : "grid-cols-2"}`}>
          <TabsTrigger value="mine">你的稿件</TabsTrigger>
          <TabsTrigger value="feed">动态</TabsTrigger>
          {canReview ? <TabsTrigger value="review">审核</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="mine" className="mt-3">
          <PostList posts={posts} />
        </TabsContent>
        <TabsContent value="feed" className="mt-3">
          <EmptyCard title="前面的区域，以后再来探索吧" />
        </TabsContent>
        {canReview ? (
          <TabsContent value="review" className="mt-3">
            <EmptyCard title="审核工作流会在 Phase 4 接入" />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function PostList({ posts }: { posts: PostItem[] }) {
  if (posts.length === 0) {
    return <EmptyCard title="还没有稿件" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {posts.map((post) => (
        <Button key={post.id} variant="secondary" className="h-auto justify-between rounded-xl p-3">
          <span className="min-w-0 text-left">
            <span className="block truncate font-medium">{post.title}</span>
            <span className="text-xs text-muted-foreground">#{post.displayId}</span>
          </span>
          <Badge variant={post.status === "pending_approval" ? "destructive" : "secondary"}>{statusLabels[post.status] ?? post.status}</Badge>
        </Button>
      ))}
    </div>
  );
}
