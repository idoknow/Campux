import { clientModule } from "./provider";

// ── Prisma 命名空间（类型 + 静态值）来自 @prisma/client ──────────────
// 命名空间成员（Prisma.UserWhereInput 等类型，以及大多数静态值）在两套 client 间结构等价，
// 统一从 @prisma/client 导出即可让 `Prisma` 同时作为「类型命名空间」和「值」使用。
export { Prisma } from "@prisma/client";
export type { PrismaClient as PrismaClientType } from "@prisma/client";

// ── 必须来自「运行时选中的那套 client」的运行时值 ────────────────────
// 已实测：跨 client 使用这些值会出错——
//   - PrismaClient 实例必须是选中 provider 的，否则连不上对应数据库。
//   - Prisma.DbNull 若来自非运行时 client，写 Json? 列会得到 `{}` 而非 SQL NULL。
//   - instanceof PrismaClientKnownRequestError 跨 client 为 false。
// 因此下面这些从 clientModule（运行时选中）取，业务代码用这些别名而非 Prisma.* 上的同名值。
export const PrismaClient = clientModule.PrismaClient;

/** SQL NULL 哨兵（写 Json? 列时表示置空）。务必用本导出而非 Prisma.DbNull。 */
export const DbNull = clientModule.Prisma.DbNull;

/** JSON `null` 哨兵（写 Json 列时表示 JSON null 值）。 */
export const JsonNull = clientModule.Prisma.JsonNull;

/** 选中 client 的事务隔离级别枚举。 */
export const TransactionIsolationLevel = clientModule.Prisma.TransactionIsolationLevel;

/**
 * 判断一个错误是否为「选中 client 的」PrismaClientKnownRequestError，并窄化其类型。
 * 替代 `error instanceof Prisma.PrismaClientKnownRequestError`（跨 client 为 false）。
 */
export function isPrismaKnownRequestError(
  error: unknown,
): error is { code: string; meta?: Record<string, unknown>; message: string } {
  return error instanceof clientModule.Prisma.PrismaClientKnownRequestError;
}

export type {
  OAuthAccessToken,
  OAuthAuthorizationCode,
  OAuthClient,
  PostStatus,
  SystemRole,
  Tenant,
  TenantMembership,
  TenantRole,
  User,
} from "@prisma/client";

export { resolveDbProvider, dbProvider, type DbProvider } from "./provider";
export {
  insensitiveContains,
  supportsSkipDuplicates,
  supportsAdvisoryLock,
  createManyDedup,
} from "./dialect";
export { hashPassword, verifyPassword } from "./password";
