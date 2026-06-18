import { dbProvider } from "./provider";

/**
 * 数据库方言适配工具。
 *
 * Campux 同一份业务查询代码要同时跑在 PostgreSQL 与 SQLite 上，但少数 Prisma 查询特性
 * 在两套 provider 行为不同或仅 PG 支持。本模块把这些差异收敛到一处，避免在业务代码里
 * 散落 `if (dbProvider === ...)`。
 *
 * 已知差异（已实测）：
 *   - `mode: "insensitive"`：PG 专有。SQLite 的 LIKE 对 ASCII 默认就不区分大小写，
 *     因此 sqlite 下应**省略** mode 字段（传了会报错）。
 *   - `createMany({ skipDuplicates: true })`：SQLite 连接器不支持 skipDuplicates。
 *   - `pg_advisory_xact_lock(...)`：PG 专有的会话级建议锁。SQLite 单写者、单进程，
 *     写操作天然串行化，无需建议锁（空操作即可）。
 *   - `"col"::text` 强制类型转换：PG 语法；SQLite 用 `CAST("col" AS TEXT)`。
 */

/**
 * 大小写不敏感的 `contains` 过滤条件。
 * - PG：返回 `{ contains, mode: "insensitive" }`
 * - SQLite：返回 `{ contains }`（LIKE 对 ASCII 默认不敏感）
 */
export function insensitiveContains(value: string): { contains: string; mode?: "insensitive" } {
  if (dbProvider === "postgresql") {
    return { contains: value, mode: "insensitive" };
  }
  return { contains: value };
}

/**
 * 是否支持 `createMany({ skipDuplicates })`。SQLite 下需改用「逐条 upsert / 先查后插」。
 */
export const supportsSkipDuplicates = dbProvider === "postgresql";

/**
 * 是否支持 PG 建议锁（pg_advisory_xact_lock）。SQLite 单写者无需此锁。
 */
export const supportsAdvisoryLock = dbProvider === "postgresql";

/**
 * 跨 provider 的「createMany + skipDuplicates」。
 *
 * SQLite 连接器不支持 `skipDuplicates`。本 helper 在 SQLite 下先按 `keyOf` 对输入数组去重
 * （进程内去重，覆盖「同一批里重复」这一最常见来源），再 createMany（不带 skipDuplicates）。
 * PG 下保持原生 `skipDuplicates: true` 行为不变。
 *
 * 注意：SQLite 路径只去「本批输入内部」的重复，**不**防「与库中已存在行」撞唯一键——
 * 现有两个调用点（新建 tenant 的成员、新建 batch 的 item）都是向「全新作用域」插入，
 * 不存在与历史行撞键的情况，因此该语义足够且等价。若将来有调用点会与历史行撞键，
 * 应改用「先查已存在键再过滤」或逐条 upsert。
 */
export async function createManyDedup<T>(
  delegate: { createMany: (args: { data: T[] }) => Promise<{ count: number }> },
  data: T[],
  keyOf: (row: T) => string,
): Promise<{ count: number }> {
  if (data.length === 0) {
    return { count: 0 };
  }
  if (dbProvider === "postgresql") {
    return (delegate as unknown as {
      createMany: (args: { data: T[]; skipDuplicates: boolean }) => Promise<{ count: number }>;
    }).createMany({ data, skipDuplicates: true });
  }
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of data) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return delegate.createMany({ data: deduped });
}
