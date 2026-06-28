import { Prisma } from "@campux/db";
import { prisma } from "./prisma";

type TagClient = typeof prisma | Prisma.TransactionClient;

export const maxTagsPerPost = 5;
export const maxTagNameLength = 16;

const tagColorPalette = [
  "#dbeafe",
  "#dcfce7",
  "#fef3c7",
  "#fee2e2",
  "#ede9fe",
  "#cffafe",
  "#fce7f3",
  "#e2e8f0",
];

export type SerializedPostTag = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  source: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  postCount?: number;
};

export type SerializedAssignedPostTag = SerializedPostTag & {
  assignmentSource: string;
  confidence: number | null;
};

export function normalizeTagName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxTagNameLength);
}

export function tagColorForName(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return tagColorPalette[hash % tagColorPalette.length] ?? tagColorPalette[0]!;
}

export function serializePostTag(tag: {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  source: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { assignments?: number };
}): SerializedPostTag {
  return {
    id: tag.id,
    name: tag.name,
    description: tag.description,
    color: tag.color,
    status: tag.status,
    source: tag.source,
    lastUsedAt: tag.lastUsedAt?.toISOString() ?? null,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
    ...(typeof tag._count?.assignments === "number" ? { postCount: tag._count.assignments } : {}),
  };
}

export function serializeAssignedPostTags(
  assignments: Array<{
    source: string;
    confidence: number | null;
    tag: {
      id: string;
      name: string;
      description: string | null;
      color: string;
      status: string;
      source: string;
      lastUsedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }> | undefined,
): SerializedAssignedPostTag[] {
  return (assignments ?? [])
    .filter((assignment) => assignment.tag.status === "active")
    .map((assignment) => ({
      ...serializePostTag(assignment.tag),
      assignmentSource: assignment.source,
      confidence: assignment.confidence,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

export async function assignPostTags(
  client: TagClient,
  input: {
    tenantId: string;
    postId: string;
    tags: Array<{ tagId: string; source: "llm"; confidence?: number | null | undefined }>;
  },
) {
  const seen = new Set<string>();
  const now = new Date();
  for (const tag of input.tags) {
    if (seen.has(tag.tagId)) {
      continue;
    }
    seen.add(tag.tagId);
    await client.postTagAssignment.upsert({
      where: {
        postId_tagId: {
          postId: input.postId,
          tagId: tag.tagId,
        },
      },
      create: {
        tenantId: input.tenantId,
        postId: input.postId,
        tagId: tag.tagId,
        source: tag.source,
        confidence: tag.confidence ?? null,
      },
      update: {
        source: tag.source,
        confidence: tag.confidence ?? null,
      },
    });
    await client.postTag.update({
      where: { id: tag.tagId },
      data: { lastUsedAt: now },
    });
  }
}

export async function listTenantPostTags(tenantId: string, options: { includeArchived?: boolean } = {}) {
  const tags = await prisma.postTag.findMany({
    where: {
      tenantId,
      ...(options.includeArchived ? {} : { status: "active" }),
    },
    include: {
      _count: {
        select: {
          assignments: true,
        },
      },
    },
    orderBy: [
      { status: "asc" },
      { lastUsedAt: "desc" },
      { updatedAt: "desc" },
      { name: "asc" },
    ],
  });
  return tags.map(serializePostTag);
}
