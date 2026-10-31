/** Pure selection policy for relation-extraction checkpoints.
 *
 * Integration contract: fetch approved/published posts in stable ascending id order
 * (including enough rows to scan), compute each current contentHash, and provide the
 * latest checkpoint for each post/hash. Persist `nextCursor` between extraction runs;
 * on wraparound scan from the beginning. Pass selected items to the existing atomic
 * claimSchoolRelationExtraction before doing provider work: selection is advisory and
 * cannot prevent concurrent workers from choosing the same item. The claim helper
 * serializes ownership; only its winner may call the provider/finalize. A changed hash
 * is a new unit of work and must not inherit the old hash's backoff/completion.
 */
export type RelationExtractionCheckpoint = {
  contentHash: string;
  status: "processing" | "failed" | "complete" | "no_relations";
  attempts: number;
  attemptedAt: Date;
};

export type RelationExtractionCandidate = {
  id: string;
  contentHash: string;
  checkpoint?: RelationExtractionCheckpoint;
};

export type CandidateSelection = {
  candidates: RelationExtractionCandidate[];
  /** Cursor after the last inspected item; feed back on the next run. */
  nextCursor: string | null;
};

export function relationExtractionRetryDelayMs(attempts: number, baseDelayMs = 60_000, maxDelayMs = 6 * 60 * 60_000): number {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(maxDelayMs, baseDelayMs * (2 ** Math.min(safeAttempts - 1, 52)));
}

function isEligible(candidate: RelationExtractionCandidate, now: Date, baseDelayMs: number, maxDelayMs: number): boolean {
  const checkpoint = candidate.checkpoint;
  if (!checkpoint || checkpoint.contentHash !== candidate.contentHash) return true;
  if (checkpoint.status === "complete" || checkpoint.status === "no_relations" || checkpoint.status === "processing") return false;
  const retryAt = checkpoint.attemptedAt.getTime() + relationExtractionRetryDelayMs(checkpoint.attempts, baseDelayMs, maxDelayMs);
  return Number.isFinite(retryAt) && retryAt <= now.getTime();
}

/** Select eligible candidates in rotating id order; pending/new work naturally precedes retries. */
export function selectRelationExtractionCandidates(
  input: { candidates: RelationExtractionCandidate[]; now: Date; limit: number; cursor?: string | null; baseDelayMs?: number; maxDelayMs?: number },
): CandidateSelection {
  const { candidates, now } = input;
  const limit = Math.max(0, Math.floor(input.limit));
  const baseDelayMs = input.baseDelayMs ?? 60_000;
  const maxDelayMs = input.maxDelayMs ?? 6 * 60 * 60_000;
  const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  if (!ordered.length || limit === 0) return { candidates: [], nextCursor: input.cursor ?? null };
  const start = input.cursor ? Math.max(0, ordered.findIndex((item) => item.id > input.cursor!)) : 0;
  const startIndex = start === -1 ? 0 : start;
  const rotated = [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)];
  const selected: RelationExtractionCandidate[] = [];
  let nextCursor = input.cursor ?? null;
  for (const item of rotated) {
    nextCursor = item.id;
    if (isEligible(item, now, baseDelayMs, maxDelayMs)) selected.push(item);
    if (selected.length >= limit) break;
  }
  return { candidates: selected, nextCursor };
}
