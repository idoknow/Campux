import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routes/posts.ts", import.meta.url), "utf8");
const publishingSource = readFileSync(new URL("../runtime/publishing.ts", import.meta.url), "utf8");

describe("post transaction compensation wiring", () => {
  test("rejects unavailable converted-GIF claims before remote ingestion", () => {
    const claimPreflight = source.indexOf("convertedGifClaimStore.assertAvailable(");
    const remoteFetch = source.indexOf("await fetch(gifUrl", claimPreflight);

    expect(claimPreflight).toBeGreaterThan(-1);
    expect(remoteFetch).toBeGreaterThan(claimPreflight);
  });

  test("consumes converted-GIF claims inside the same Prisma transaction as post creation", () => {
    const transactionStart = source.indexOf("post = await prisma.$transaction(");
    const transactionEnd = source.indexOf("{ isolationLevel: TransactionIsolationLevel.Serializable }", transactionStart);
    const claimConsume = source.indexOf("convertedGifClaimStore.consumeUsing(", transactionStart);
    const postCreate = source.indexOf("const created = await tx.post.create(", transactionStart);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(transactionEnd).toBeGreaterThan(transactionStart);
    expect(claimConsume).toBeGreaterThan(transactionStart);
    expect(claimConsume).toBeLessThan(transactionEnd);
    expect(postCreate).toBeGreaterThan(claimConsume);
    expect(postCreate).toBeLessThan(transactionEnd);
    expect(source).not.toContain("convertedGifClaimStore.restore(");
  });

  test("handles unknown commit outcomes before attachment compensation", () => {
    const routeCatch = source.indexOf("if (err instanceof PostCreateTransactionOutcomeUnknownError)");
    const attachmentCleanup = source.indexOf("await deleteAttachmentObjects(config, uploadedKeys)", routeCatch);

    expect(routeCatch).toBeGreaterThan(-1);
    expect(attachmentCleanup).toBeGreaterThan(routeCatch);
  });
});

describe("publish fanout transaction wiring", () => {
  test("requeue still schedules atomically via shared helper before enqueueing", () => {
    const requeueStart = publishingSource.indexOf("export async function requeuePublishFanout");
    const requeueEnd = publishingSource.indexOf("export async function enqueueBatchPublishFanout", requeueStart);
    const requeueSource = publishingSource.slice(requeueStart, requeueEnd);
    const helperStart = publishingSource.indexOf("async function scheduleAndEnqueueFanoutAttempts");
    const helperEnd = publishingSource.indexOf("export async function enqueuePublishFanout", helperStart);
    const helperSource = publishingSource.slice(helperStart, helperEnd);
    const transactionStart = helperSource.indexOf("await prisma.$transaction(async (tx)");
    const transactionalSchedule = helperSource.indexOf("schedulePublishAttemptInTransaction(tx", transactionStart);
    const enqueue = helperSource.indexOf("enqueueAttemptUnique(queue", transactionStart);

    expect(requeueStart).toBeGreaterThan(-1);
    expect(requeueSource).toContain("scheduleAndEnqueueFanoutAttempts({");
    expect(transactionStart).toBeGreaterThan(-1);
    expect(transactionalSchedule).toBeGreaterThan(transactionStart);
    expect(enqueue).toBeGreaterThan(transactionalSchedule);
  });

  test("single-post fanout creates attempts inside the lock transaction before any enqueue", () => {
    const fanoutStart = publishingSource.indexOf("export async function enqueuePublishFanout");
    const fanoutEnd = publishingSource.indexOf("export async function requeuePublishFanout", fanoutStart);
    const fanoutSource = publishingSource.slice(fanoutStart, fanoutEnd);

    const lock = fanoutSource.indexOf("lockPublishFanout(tx, tenantId, `post:${postId}`)");
    const transactionStart = fanoutSource.indexOf("await prisma.$transaction(async (tx)");
    const transactionalSchedule = fanoutSource.indexOf("schedulePublishAttemptInTransaction(tx", lock);
    const transactionEnd = fanoutSource.indexOf("}, {", transactionalSchedule);
    const enqueue = fanoutSource.indexOf("enqueueAttemptUnique(queue", transactionEnd);

    expect(lock).toBeGreaterThan(-1);
    expect(transactionStart).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(transactionStart);
    // attempt 必须在锁事务内创建，锁释放后并发方才能看到并 skip
    expect(transactionalSchedule).toBeGreaterThan(lock);
    expect(transactionalSchedule).toBeLessThan(transactionEnd);
    // 入队只能在事务提交之后
    expect(enqueue).toBeGreaterThan(transactionEnd);
    // 不得再把调度甩到锁外的 scheduleAndEnqueueFanoutAttempts
    expect(fanoutSource).not.toContain("scheduleAndEnqueueFanoutAttempts({");
  });

  test("commits every batch target and its durable marker before enqueueing", () => {
    const fanoutStart = publishingSource.indexOf("export async function enqueueBatchPublishFanout");
    const fanoutEnd = publishingSource.indexOf("async function ensurePostPublishSummary", fanoutStart);
    const fanoutSource = publishingSource.slice(fanoutStart, fanoutEnd);
    const transactionStart = fanoutSource.indexOf("const attempts = await prisma.$transaction(async (tx)");
    const transactionalSchedule = fanoutSource.indexOf("schedulePublishAttemptInTransaction(tx", transactionStart);
    const durableMarker = fanoutSource.indexOf("data: { flushedAt: new Date() }", transactionalSchedule);
    const enqueue = fanoutSource.indexOf("enqueueAttemptUnique(queue", durableMarker);

    expect(fanoutStart).toBeGreaterThan(-1);
    expect(fanoutEnd).toBeGreaterThan(fanoutStart);
    expect(transactionStart).toBeGreaterThan(-1);
    expect(transactionalSchedule).toBeGreaterThan(transactionStart);
    expect(durableMarker).toBeGreaterThan(transactionalSchedule);
    expect(enqueue).toBeGreaterThan(durableMarker);
  });
});
