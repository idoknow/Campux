export function toPostListItem(post: {
  id: string;
  displayId: number;
  text: string;
  attachments: unknown;
  anonymous: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  logs?: Array<{
    oldStatus: string | null;
    newStatus: string;
    comment: string;
    createdAt: Date;
  }>;
}) {
  const recallLog = post.logs
    ?.filter((log) => log.oldStatus === "published" && log.newStatus === "pending_recall")
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const recallReason = recallLog?.comment.startsWith("用户申请撤回：") ? recallLog.comment.slice("用户申请撤回：".length).trim() : null;

  return {
    id: post.id,
    displayId: post.displayId,
    title: post.text.length > 28 ? `${post.text.slice(0, 28)}...` : post.text,
    text: post.text,
    attachments: post.attachments,
    anonymous: post.anonymous,
    status: post.status,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    recallReason,
  };
}
