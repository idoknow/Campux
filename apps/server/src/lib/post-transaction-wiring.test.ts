import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routes/posts.ts", import.meta.url), "utf8");

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
