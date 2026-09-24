/**
 * 广播通知列表排序。抽成纯函数，与路由/Prisma 解耦，便于单测。
 */

/** 排序需要的最小字段集合。 */
export type SortableBroadcast = {
  id: string;
  endsAt: Date;
  broadcastCount: number;
  modified: boolean;
  createdAt: Date;
};

/**
 * 新通知的三色排序：未通知（红）→ 已修改（橙）→ 已通知（绿），
 * 组内按结束时间升序（时间快结束的排前面）。
 *
 * 分桶键与卡片着色键是同一套判定（count=0 → 红、modified → 橙、count>0 → 绿），
 * 因此修改过的通知即便被广播多次仍保持橙色，不会退回红色。
 *
 * 历史通知按发出时间从新到旧。
 */
export function sortBroadcasts<T extends SortableBroadcast>(
  items: T[],
  scope: "active" | "history",
): T[] {
  if (scope === "history") {
    return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  const bucket = (item: T) => (item.broadcastCount === 0 ? 0 : item.modified ? 1 : 2);
  return [...items].sort(
    (a, b) => bucket(a) - bucket(b) || a.endsAt.getTime() - b.endsAt.getTime(),
  );
}
