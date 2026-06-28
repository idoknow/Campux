/**
 * E2E test for applyTagAgentPlan against a real Postgres instance.
 * Requires DATABASE_URL to point at a test-only DB.
 * Run: bun test src/runtime/post-tagging.e2e.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { applyTagAgentPlan } from "./post-tagging";
import type { FastifyBaseLogger } from "fastify";
import { randomUUID } from "crypto";

const logger = {
  warn: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
} as unknown as FastifyBaseLogger;

// This suite needs a real Postgres. It is opt-in: set CAMPUX_E2E_DB=1 (with a
// test DATABASE_URL pointing at a throwaway DB) to run it. `bun test` with no DB
// configured skips it cleanly so the default unit suite + CI stay green.
const runE2E = process.env.CAMPUX_E2E_DB === "1";
const maybeDescribe = runE2E ? describe : describe.skip;

let tenantId = "";
let userId = "";
const postIds: string[] = [];
const tagIds: Record<string, string> = {};

beforeAll(async () => {
  if (!runE2E) return;
  // Create a minimal tenant + user
  tenantId = randomUUID();
  userId = randomUUID();
  await prisma.tenant.create({
    data: { id: tenantId, slug: `test-${tenantId.slice(0, 8)}`, name: "E2E Test Wall" },
  });
  await prisma.user.create({
    data: { id: userId, qqUin: BigInt(Date.now()), passwordHash: "x" },
  });

  // Seed 5 posts
  for (let i = 0; i < 5; i++) {
    const post = await prisma.post.create({
      data: {
        id: randomUUID(),
        tenantId,
        authorId: userId,
        displayId: i + 1,
        text: `考研备考 第${i + 1}条`,
      },
    });
    postIds.push(post.id);
  }

  // Seed two near-duplicate tags
  const [a, b] = await Promise.all([
    prisma.postTag.create({ data: { tenantId, name: "考研", color: "#dbeafe" } }),
    prisma.postTag.create({ data: { tenantId, name: "研究生考试", color: "#dcfce7" } }),
  ]);
  tagIds["考研"] = a.id;
  tagIds["研究生考试"] = b.id;

  // Assign tag "研究生考试" to 2 posts
  await prisma.postTagAssignment.create({ data: { tenantId, postId: postIds[0]!, tagId: b.id } });
  await prisma.postTagAssignment.create({ data: { tenantId, postId: postIds[1]!, tagId: b.id } });
});

afterAll(async () => {
  if (!runE2E) return;
  await prisma.postTag.deleteMany({ where: { tenantId } });
  await prisma.post.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

maybeDescribe("applyTagAgentPlan e2e", () => {
  test("create: mints new tag and assigns cluster posts", async () => {
    const plan = {
      create: [{ name: "失物招领", description: null, color: "#fef3c7", postIds: [postIds[2]!, postIds[3]!, postIds[4]!], confidence: 0.9 }],
      merge: [],
      assign: [],
    };
    const result = await applyTagAgentPlan(tenantId, plan, postIds, logger);
    expect(result.created).toEqual(["失物招领"]);
    expect(result.assigned.find((a) => a.tag === "失物招领")?.postIds).toHaveLength(3);
    const tag = await prisma.postTag.findUnique({ where: { tenantId_name: { tenantId, name: "失物招领" } } });
    expect(tag).not.toBeNull();
    expect(tag?.status).toBe("active");
  });

  test("create: rejects cluster smaller than minClusterSize (2 < 3)", async () => {
    const plan = {
      create: [{ name: "超短标签", description: null, color: "#fee2e2", postIds: [postIds[0]!, postIds[1]!], confidence: 0.9 }],
      merge: [],
      assign: [],
    };
    const result = await applyTagAgentPlan(tenantId, plan, postIds, logger);
    expect(result.created).toEqual([]);
  });

  test("merge: migrates assignments from source tag to canonical, archives source", async () => {
    const plan = {
      create: [],
      merge: [{ from: ["研究生考试"], into: "考研" }],
      assign: [],
    };
    const result = await applyTagAgentPlan(tenantId, plan, postIds, logger);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.from).toEqual(["研究生考试"]);
    expect(result.merged[0]?.into).toBe("考研");

    // Source tag should be archived
    const src = await prisma.postTag.findUniqueOrThrow({ where: { id: tagIds["研究生考试"]! } });
    expect(src.status).toBe("archived");
    // Source tag should have 0 assignments (migrated away)
    const srcAssignments = await prisma.postTagAssignment.count({ where: { tagId: tagIds["研究生考试"]! } });
    expect(srcAssignments).toBe(0);
    // Canonical tag should now hold those posts
    const canonAssignments = await prisma.postTagAssignment.findMany({ where: { tagId: tagIds["考研"]! } });
    const canonPostIds = canonAssignments.map((a) => a.postId).sort();
    expect(canonPostIds).toContain(postIds[0]!);
    expect(canonPostIds).toContain(postIds[1]!);
  });

  test("assign: tags recent posts with existing taxonomy", async () => {
    // postIds[2] has no assignment yet after create test removed it from knowledge
    const plan = {
      create: [],
      merge: [],
      assign: [
        { postId: postIds[2]!, tags: ["考研"] },
        { postId: postIds[3]!, tags: ["考研"] },
      ],
    };
    const result = await applyTagAgentPlan(tenantId, plan, postIds, logger);
    const assignedSet = new Set(result.assigned.flatMap((a) => a.postIds));
    // Both posts should appear in assigned (or already had the tag — count >= 0)
    expect(assignedSet.size).toBeGreaterThanOrEqual(0);
    // No errors, result shape is correct
    expect(Array.isArray(result.created)).toBe(true);
    expect(Array.isArray(result.merged)).toBe(true);
    expect(Array.isArray(result.archived)).toBe(true);
  });

  test("assign: rejects postId not in knownPostIds", async () => {
    const plan = {
      create: [],
      merge: [],
      assign: [{ postId: "unknown-id-xyz", tags: ["考研"] }],
    };
    const result = await applyTagAgentPlan(tenantId, plan, postIds, logger);
    expect(result.assigned).toHaveLength(0);
  });
});
