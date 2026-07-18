export type PostPersistenceState = "not-started" | "rolled-back" | "committed" | "unknown";

export function shouldCompensatePostAttachments(state: PostPersistenceState): boolean {
  return state === "not-started" || state === "rolled-back";
}

export type PostCreateTransactionOutcome<T> =
  | { kind: "committed"; post: T }
  | { kind: "rolled-back" }
  | { kind: "unknown"; error: unknown };

export async function reconcilePostCreateTransactionOutcome<T>(
  loadCandidatePost: () => Promise<T | null>,
): Promise<PostCreateTransactionOutcome<T>> {
  try {
    const post = await loadCandidatePost();
    return post
      ? { kind: "committed", post }
      : { kind: "rolled-back" };
  } catch (error) {
    return { kind: "unknown", error };
  }
}
