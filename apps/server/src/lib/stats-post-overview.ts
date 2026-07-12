const postStatuses = [
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "publishing",
  "partially_failed",
  "failed",
  "published",
  "pending_recall",
  "recalled",
] as const;

type StatsPost = {
  status: string;
  anonymous: boolean;
  attachments: unknown;
  logs: unknown[];
};

export function buildPostRangeOverview(posts: StatsPost[]) {
  const byStatus: Record<string, number> = Object.fromEntries(postStatuses.map((status) => [status, 0]));
  for (const post of posts) {
    byStatus[post.status] = (byStatus[post.status] ?? 0) + 1;
  }

  const totalPosts = posts.length;
  const privateSourceCount = posts.filter((post) => post.logs.length > 0).length;
  const imagesTotal = posts.reduce((sum, post) => sum + getAttachmentCount(post.attachments), 0);
  const postsWithImages = posts.filter((post) => getAttachmentCount(post.attachments) > 0).length;
  const anonymousPosts = posts.filter((post) => post.anonymous).length;

  return {
    totalPosts,
    byStatus,
    bySource: {
      private: privateSourceCount,
      web: totalPosts - privateSourceCount,
    },
    anonymousPosts,
    anonymousRate: totalPosts > 0 ? roundPercent(anonymousPosts, totalPosts) : null,
    postsWithImages,
    imageRate: totalPosts > 0 ? roundPercent(postsWithImages, totalPosts) : null,
    imagesTotal,
    avgImagesPerPost: totalPosts > 0 ? Math.round((imagesTotal / totalPosts) * 100) / 100 : null,
  };
}

function getAttachmentCount(attachments: unknown) {
  return Array.isArray(attachments) ? attachments.length : 0;
}

function roundPercent(value: number, total: number) {
  return Math.round((value / total) * 1000) / 10;
}
