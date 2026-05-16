import { Prisma } from "@campux/db";
import { prisma } from "./prisma";

export function normalizeUserSearchKeyword(input: string | null | undefined) {
  return input?.trim() ?? "";
}

export async function buildUserContainsSearch(keyword: string): Promise<Prisma.UserWhereInput | null> {
  const normalized = normalizeUserSearchKeyword(keyword);
  if (!normalized) {
    return null;
  }

  const qqMatches = /^\d+$/.test(normalized)
    ? await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "User"
        WHERE "qqUin"::text LIKE ${`%${normalized}%`}
        LIMIT 500
      `
    : [];

  return {
    OR: [
      {
        id: {
          contains: normalized,
          mode: "insensitive",
        },
      },
      ...(qqMatches.length > 0 ? [{ id: { in: qqMatches.map((user) => user.id) } }] : []),
      {
        displayName: {
          contains: normalized,
          mode: "insensitive",
        },
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
