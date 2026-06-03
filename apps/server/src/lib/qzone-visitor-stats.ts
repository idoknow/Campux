const dayMs = 24 * 60 * 60 * 1000;

export type QZoneVisitorCounts = {
  todayCount: number;
  totalCount: number;
};

export type QZoneVisitorSnapshotInput = QZoneVisitorCounts & {
  botAccountId?: string;
  date: Date;
};

export type QZoneVisitorTargetInput = {
  id: string;
  displayName: string;
  botAccountId: string;
  botDisplayName: string;
  botQqUin: string;
};

export function parseQZoneVisitorCounts(data: unknown): QZoneVisitorCounts | null {
  if (!data || typeof data !== "object" || !("todaycount" in data) || !("totalcount" in data)) {
    return null;
  }
  const source = data as { todaycount: unknown; totalcount: unknown };
  const todayCount = toFiniteCount(source.todaycount);
  const totalCount = toFiniteCount(source.totalcount);
  if (todayCount === null || totalCount === null) {
    return null;
  }
  return { todayCount, totalCount };
}

export function buildQZoneVisitorDailySeries(snapshots: QZoneVisitorSnapshotInput[], start: Date, end: Date) {
  const days = buildEmptyQZoneVisitorDailySeries(start, end);
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const snapshot of snapshots) {
    const day = byDate.get(formatDayKey(snapshot.date));
    if (!day) continue;
    day.todayCount += snapshot.todayCount;
    day.totalCount += snapshot.totalCount;
  }
  return days;
}

export function buildQZoneVisitorTargetSeries(snapshots: QZoneVisitorSnapshotInput[], targets: QZoneVisitorTargetInput[], start: Date, end: Date) {
  return targets.map((target) => ({
    id: target.id,
    displayName: target.displayName,
    bot: {
      displayName: target.botDisplayName,
      qqUin: target.botQqUin,
    },
    daily: buildQZoneVisitorDailySeries(
      snapshots.filter((snapshot) => snapshot.botAccountId === target.botAccountId),
      start,
      end,
    ),
  }));
}

export function qzoneVisitorSnapshotDate(date: Date) {
  return startOfDay(date);
}

function buildEmptyQZoneVisitorDailySeries(start: Date, end: Date) {
  const startDay = startOfDay(start);
  const endDay = startOfDay(end);
  const days = [];
  for (let time = startDay.getTime(); time <= endDay.getTime(); time += dayMs) {
    days.push({
      date: formatDayKey(new Date(time)),
      todayCount: 0,
      totalCount: 0,
    });
  }
  return days;
}

function toFiniteCount(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return null;
  }
  return Math.floor(numberValue);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
