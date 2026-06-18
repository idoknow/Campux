import { Prisma, dbProvider, insensitiveContains } from "@campux/db";
import { prisma } from "./prisma";

export function normalizeUserSearchKeyword(input: string | null | undefined) {
  return input?.trim() ?? "";
}

export async function buildUserContainsSearch(keyword: string): Promise<Prisma.UserWhereInput | null> {
  const normalized = normalizeUserSearchKeyword(keyword);
  if (!normalized) {
    return null;
  }

  // qqUin 是 BigInt 列，按「数字子串」匹配需要把它转成文本再 LIKE。
  // PG 用 `"qqUin"::text`，SQLite 用 `CAST("qqUin" AS TEXT)`——两者语法不同。
  const qqMatches = /^\d+$/.test(normalized)
    ? dbProvider === "postgresql"
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "User"
          WHERE "qqUin"::text LIKE ${`%${normalized}%`}
          LIMIT 500
        `
      : await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "User"
          WHERE CAST("qqUin" AS TEXT) LIKE ${`%${normalized}%`}
          LIMIT 500
        `
    : [];

  return {
    OR: [
      {
        id: insensitiveContains(normalized),
      },
      ...(qqMatches.length > 0 ? [{ id: { in: qqMatches.map((user) => user.id) } }] : []),
      {
        displayName: insensitiveContains(normalized),
      },
    ],
  };
}

export async function findUserIdsByContainsSearch(keyword: string, take = 500) {
  const where = await buildUserContainsSearch(keyword);
  if (!where) {
    return [];
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
    },
    take,
  });

  return users.map((user) => user.id);
}
