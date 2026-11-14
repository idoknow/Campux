const chinaDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * 按上海时区格式化为 `YYYY-MM-DD`。
 *
 * 不要用 `toISOString().slice(0, 10)`：那是 UTC 日期，凌晨 0–8 点会算成前一天，
 * 展示给用户的"某一天"会整体错位。
 */
export function formatChinaDate(date: Date): string {
  return chinaDateFormatter.format(date);
}
