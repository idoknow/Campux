export type ReviewNotificationBot = {
  id: string;
  enabled: boolean;
  reviewGroupId: string | null;
  reviewNotificationEnabled: boolean;
  createdAt: Date;
};

export function selectReviewNotificationBot<T extends ReviewNotificationBot>(bots: T[]): T | null {
  return [...bots]
    .filter((bot) => bot.enabled && Boolean(bot.reviewGroupId) && bot.reviewNotificationEnabled)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    [0] ?? null;
}
