import { describe, expect, it } from "bun:test";
import { inferCandidateSensitivity, mergeEntityEvidence, runSchoolModelRefreshTick } from "./school-model-refresh";

describe("school model refresh", () => {
  it("promotes a safe candidate only after distinct post evidence and deduplicates identical analysis", () => {
    const first = { analysisId: "a1", postId: "p1", type: "topic", name: "考试周", sensitivity: "normal" as const, confidence: 0.8 };
    expect(mergeEntityEvidence([], first).promoted).toBe(false);
    expect(mergeEntityEvidence([first], first).evidence).toHaveLength(1);
    expect(mergeEntityEvidence([first], { ...first, analysisId: "a2", postId: "p2" }).promoted).toBe(true);
  });
  it("never trusts a model-provided safe label for a sensitive finding", () => {
    expect(inferCandidateSensitivity({ type: "person_alias", excerpt: "姓名", reason: "privacy", sensitivity: "normal" })).toBe("sensitive");
    expect(inferCandidateSensitivity({ type: "topic", excerpt: "考试周", reason: "topic" })).toBe("normal");
  });

  it("refreshes each active tenant on startup", async () => {
    const seen: string[] = [];
    const client = { tenant: { async findMany() { return [{ id: "one" }, { id: "two" }]; } } };
    await runSchoolModelRefreshTick(client, async (id) => { seen.push(id); }, { error() {} });
    expect(seen.sort()).toEqual(["one", "two"]);
  });
});
