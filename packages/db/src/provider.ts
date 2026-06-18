/**
 * 运行时数据库 Provider 选择。
 *
 * Campux 支持两种数据库形态，同一套数据模型、同一份业务查询代码：
 *   - PostgreSQL（默认生产形态，Docker 部署 / 官方实例）—— `@prisma/client`
 *   - SQLite（零依赖单文件自托管形态）—— `../generated/sqlite`
 *
 * 选择规则：看 `DATABASE_URL` 的 scheme（`CAMPUX_DB_PROVIDER` 可显式覆盖）。
 *   - `file:` / `sqlite:` 开头、以 `.db`/`.sqlite` 结尾、或未设置 -> SQLite
 *   - 其余（postgres / postgresql 等）-> PostgreSQL
 *
 * 关键约束：`instanceof Prisma.PrismaClientKnownRequestError`、`Prisma.DbNull`、
 * `Prisma.TransactionIsolationLevel.Serializable` 等运行时值必须来自「真正实例化的那套
 * client」——跨 client 的 instanceof 为 false（已实测）。因此本模块同步只 require 选中的
 * 一套，`Prisma` 命名空间与 `PrismaClient` 类都从同一个 mod 取，保证运行时一致。
 *
 * 两套 client 的「类型」结构一致（同一份数据模型），TypeScript 侧统一以 `@prisma/client`
 * 的类型为准（见 index.ts 的 `export type`），不影响运行时选择。
 */

export type DbProvider = "postgresql" | "sqlite";

/**
 * 判定当前应使用的数据库 Provider。纯函数，便于单测。
 * @param databaseUrl process.env.DATABASE_URL
 * @param explicit    process.env.CAMPUX_DB_PROVIDER（可选，强制覆盖）
 */
export function resolveDbProvider(
  databaseUrl: string | undefined,
  explicit?: string | undefined,
): DbProvider {
  const forced = explicit?.trim().toLowerCase();
  if (forced === "sqlite" || forced === "postgresql" || forced === "postgres") {
    return forced === "postgres" ? "postgresql" : (forced as DbProvider);
  }

  const url = databaseUrl?.trim() ?? "";
  if (url === "") {
    // 未配置 DATABASE_URL：单文件 / 自托管默认走 SQLite（零依赖）。
    return "sqlite";
  }
  const lower = url.toLowerCase();
  if (
    lower.startsWith("file:") ||
    lower.startsWith("sqlite:") ||
    lower.endsWith(".db") ||
    lower.endsWith(".sqlite")
  ) {
    return "sqlite";
  }
  return "postgresql";
}

export const dbProvider: DbProvider = resolveDbProvider(
  process.env.DATABASE_URL,
  process.env.CAMPUX_DB_PROVIDER,
);

/**
 * 同步加载选中的 Prisma client 模块。
 *
 * 用 `require` 而非顶层静态 import：静态 import 两套 client 会让 bundler 同时打包并
 * 各自「定址」引擎，而我们只想要选中的那套在运行时被实例化。`require` 让选择在
 * 模块求值时一次性完成且只触达一套。
 *
 * 注意：bun 的 `--compile` 会把两套 client 都打进二进制（因为下面两个 require 路径都是
 * 静态字符串字面量，可被静态分析内嵌），但只有选中的那套会被实际 require 执行。这是有意
 * 为之：单个二进制需要同时具备 sqlite（默认）与 postgres（用户改用外部 PG）两种能力。
 */
function loadClientModule(): typeof import("@prisma/client") {
  if (dbProvider === "sqlite") {
    // 生成产物：scripts/generate-sqlite-schema.ts -> packages/db/generated/sqlite
    return require("../generated/sqlite") as typeof import("@prisma/client");
  }
  return require("@prisma/client") as typeof import("@prisma/client");
}

export const clientModule = loadClientModule();
