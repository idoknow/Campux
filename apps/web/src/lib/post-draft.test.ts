import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  clearDraftMirror,
  clearPostDraft,
  POST_DRAFT_MAX_LENGTH,
  readLastDraftTenantId,
  readPostDraft,
  writePostDraft,
} from "./post-draft";

const DRAFT = {
  text: "今晚食堂二楼有免费的糖画，先到先得。",
  anonymous: true,
  anonymousAvatar: "cat.svg",
  bgColor: "pink",
  textColor: "dark_red",
  font: "round",
};

class FakeStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

// bun:test 默认没有浏览器全局，补一个最小 localStorage 实现。
beforeAll(() => {
  if (!globalThis.localStorage) {
    globalThis.localStorage = new FakeStorage() as unknown as Storage;
  }
});

function seedDraftMirror(tenantId: string, draft: Partial<typeof DRAFT>) {
  const record = { ...DRAFT, ...draft, tenantId, savedAt: Date.now() };
  globalThis.localStorage.setItem(`campux.post-draft.${tenantId}`, JSON.stringify(record));
}

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  globalThis.localStorage.clear();
});

describe("readPostDraft", () => {
  it("restores a saved draft for the current tenant", () => {
    seedDraftMirror("tenant-a", { text: "正文 A" });
    const draft = readPostDraft("tenant-a");
    expect(draft?.text).toBe("正文 A");
    expect(draft?.anonymous).toBe(true);
    expect(draft?.anonymousAvatar).toBe("cat.svg");
    expect(draft?.bgColor).toBe("pink");
    expect(draft?.textColor).toBe("dark_red");
    expect(draft?.font).toBe("round");
    expect(draft?.tenantId).toBe("tenant-a");
  });

  it("returns null for an unknown tenant", () => {
    expect(readPostDraft("tenant-x")).toBeNull();
  });

  it("points the initial-load read at the tenant that was saved last", async () => {
    await writePostDraft("tenant-a", { ...DRAFT, text: "正文 A" });
    expect(readPostDraft(readLastDraftTenantId())?.text).toBe("正文 A");
  });

  it("ignores a corrupt or malformed payload", () => {
    globalThis.localStorage.setItem("campux.post-draft.tenant-a", "{not json");
    expect(readPostDraft("tenant-a")).toBeNull();

    globalThis.localStorage.setItem(
      "campux.post-draft.tenant-a",
      JSON.stringify({ text: "正文", anonymous: "yes", anonymousAvatar: "", bgColor: "", textColor: "", font: "" }),
    );
    expect(readPostDraft("tenant-a")).toBeNull();

    globalThis.localStorage.setItem(
      "campux.post-draft.tenant-a",
      JSON.stringify({ ...DRAFT, text: "x".repeat(POST_DRAFT_MAX_LENGTH + 1) }),
    );
    expect(readPostDraft("tenant-a")).toBeNull();
  });
});

describe("writePostDraft", () => {
  it("persists the draft so a later read restores it", async () => {
    await writePostDraft("tenant-a", DRAFT);
    const draft = readPostDraft("tenant-a");
    expect(draft?.text).toBe(DRAFT.text);
    expect(draft?.font).toBe(DRAFT.font);
  });

  it("discards an empty draft", async () => {
    seedDraftMirror("tenant-a", { text: "正文 A" });
    await writePostDraft("tenant-a", { ...DRAFT, text: "   " });
    expect(readPostDraft("tenant-a")).toBeNull();
  });

  it("keeps each tenant's draft separate", async () => {
    await writePostDraft("tenant-a", { ...DRAFT, text: "正文 A" });
    await writePostDraft("tenant-b", { ...DRAFT, text: "正文 B" });
    expect(readPostDraft("tenant-a")?.text).toBe("正文 A");
    expect(readPostDraft("tenant-b")?.text).toBe("正文 B");

    await clearPostDraft("tenant-a");
    expect(readPostDraft("tenant-a")).toBeNull();
    expect(readPostDraft("tenant-b")?.text).toBe("正文 B");
  });

  it("drops every tenant's mirror after logout", () => {
    seedDraftMirror("tenant-a", { text: "上一个用户的正文" });
    seedDraftMirror("tenant-b", { text: "另一位用户的正文" });
    clearDraftMirror();
    expect(readPostDraft("tenant-a")).toBeNull();
    expect(readPostDraft("tenant-b")).toBeNull();
    expect(readLastDraftTenantId()).toBe("");
  });
});
