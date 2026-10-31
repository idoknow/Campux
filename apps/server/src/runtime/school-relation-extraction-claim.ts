/** Atomic checkpoint claim for a school-relation extraction. */
export type ExtractionCheckpointClient = {
  schoolRelationExtraction: {
    createMany(args: {
      data: { tenantId: string; postId: string; contentHash: string; status: string; attempts: number; attemptedAt: Date }[];
      skipDuplicates: true;
    }): Promise<{ count: number }>;
    updateMany(args: {
      where: { tenantId: string; postId: string; contentHash: string; status: string; attemptedAt?: { lt: Date } };
      data: { status: string; attempts: { increment: number }; attemptedAt: Date };
    }): Promise<{ count: number }>;
  };
};

export type ExtractionClaim = { claimed: boolean; attemptAt?: Date };

/**
 * Claims missing/failed/stale checkpoints using unique insert + conditional update.
 * `staleBefore` must be a cutoff older than the maximum expected provider duration;
 * it permits recovery after a crashed worker without allowing fresh claims to be stolen.
 * Release/finalize the claim by conditionally updating status `processing` and
 * attemptedAt to the returned attemptAt, so an expired worker cannot overwrite a newer claim.
 */
export async function claimSchoolRelationExtraction(
  db: ExtractionCheckpointClient,
  input: { tenantId: string; postId: string; contentHash: string; staleBefore: Date; now?: Date },
): Promise<ExtractionClaim> {
  const now = input.now ?? new Date();
  const where = { tenantId: input.tenantId, postId: input.postId, contentHash: input.contentHash };
  const created = await db.schoolRelationExtraction.createMany({
    data: [{ ...where, status: "processing", attempts: 1, attemptedAt: now }],
    skipDuplicates: true,
  });
  if (created.count === 1) return { claimed: true, attemptAt: now };

  const reclaimed = await db.schoolRelationExtraction.updateMany({
    where: { ...where, status: "failed" },
    data: { status: "processing", attempts: { increment: 1 }, attemptedAt: now },
  });
  if (reclaimed.count === 1) return { claimed: true, attemptAt: now };

  // Expired processing claims can be recovered; completed statuses are never claimed.
  const expired = await db.schoolRelationExtraction.updateMany({
    where: { ...where, status: "processing", attemptedAt: { lt: input.staleBefore } },
    data: { status: "processing", attempts: { increment: 1 }, attemptedAt: now },
  });
  return expired.count === 1 ? { claimed: true, attemptAt: now } : { claimed: false };
}
