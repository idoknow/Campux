/**
 * 投稿草稿自动保存到浏览器本地数据库（IndexedDB）。
 *
 * 草稿按租户隔离，遇到服务故障、页面崩溃或浏览器被强杀时，重新打开投稿页可恢复正文与设置。
 * IndexedDB 写入是异步的，所以额外维护一份 localStorage 镜像：镜像随每次写入同步落盘，
 * 既让首屏能立即回填（不必先看到空表单再跳变），也兜底 IndexedDB 不可用的情况。
 */

const DB_NAME = "campux";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

const MIRROR_PREFIX = "campux.post-draft.";

export const POST_DRAFT_MAX_LENGTH = 1_000;

/** 记住最近写入草稿的租户，供首屏同步回填时定位对应的 localStorage 条目。 */
const LAST_TENANT_KEY = "campux.post-draft.last-tenant";

export interface PostDraftState {
  text: string;
  anonymous: boolean;
  anonymousAvatar: string;
  bgColor: string;
  textColor: string;
  font: string;
}

export interface PostDraftRecord extends PostDraftState {
  tenantId: string;
  savedAt: number;
}

function isDraftState(value: unknown): value is PostDraftState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.text === "string" &&
    candidate.text.length <= POST_DRAFT_MAX_LENGTH &&
    typeof candidate.anonymous === "boolean" &&
    typeof candidate.anonymousAvatar === "string" &&
    typeof candidate.bgColor === "string" &&
    typeof candidate.textColor === "string" &&
    typeof candidate.font === "string"
  );
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function requestOnce<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("IndexedDB 不可用"));
  });
}

function transactionOnce(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB 不可用"));
    transaction.onabort = () => reject(new Error("IndexedDB 不可用"));
  });
}

function openDraftDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME, { keyPath: "tenantId" });
    }
  };
  return requestOnce(request);
}

function storage(): Storage | null {
  if (typeof globalThis === "undefined") {
    return null;
  }
  return globalThis.localStorage ?? null;
}

function mirrorKey(tenantId: string): string {
  return `${MIRROR_PREFIX}${tenantId}`;
}

/** 同步写入草稿镜像，供首屏回填与页面关闭时兜底使用。 */
export function writeDraftMirrorSync(tenantId: string, draft: PostDraftState): void {
  if (!tenantId || draft.text.trim().length === 0) {
    return;
  }
  writeDraftMirror(tenantId, draft);
}

/** 首屏用：取最近写入草稿的租户 ID，读不到时返回空串。 */
export function readLastDraftTenantId(): string {
  try {
    return storage()?.getItem(LAST_TENANT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeDraftMirror(tenantId: string, draft: PostDraftState): void {
  if (!tenantId) {
    return;
  }
  const record: PostDraftRecord = { ...draft, tenantId, savedAt: Date.now() };
  try {
    const store = storage();
    if (!store) {
      return;
    }
    store.setItem(mirrorKey(tenantId), JSON.stringify(record));
    store.setItem(LAST_TENANT_KEY, tenantId);
  } catch {
    // 存储配额已满或被禁用时，草稿只是便利性功能，不影响正常填写与提交。
  }
}

function removeDraftMirror(tenantId: string): void {
  if (!tenantId) {
    return;
  }
  try {
    const store = storage();
    if (!store) {
      return;
    }
    store.removeItem(mirrorKey(tenantId));
    // 清掉的正是最近写入的那份草稿时，指针一并移除，避免误回填。
    if (store.getItem(LAST_TENANT_KEY) === tenantId) {
      store.removeItem(LAST_TENANT_KEY);
    }
  } catch {
    // Ignore.
  }
}

export function clearDraftMirror(): void {
  try {
    const store = storage();
    if (!store) {
      return;
    }
    // 本地存储的 key 形如 campux.post-draft.<租户 ID>，登出时整体清空，
    // 避免下一个登录的用户看到上一位用户的草稿。
    const keysToRemove: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && key.startsWith(MIRROR_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => store.removeItem(key));
  } catch {
    // Ignore.
  }
}

/** 同步取回当前租户的草稿，只依赖 localStorage 镜像，首屏即可回填。 */
export function readPostDraft(tenantId: string): PostDraftRecord | null {
  if (!tenantId) {
    return null;
  }
  try {
    const store = storage();
    if (!store) {
      return null;
    }
    const raw = store.getItem(mirrorKey(tenantId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isDraftState(parsed)) {
      return null;
    }
    return { ...parsed, tenantId, savedAt: 0 };
  } catch {
    return null;
  }
}

function commitRecord(tenantId: string, draft: PostDraftState): Promise<void> {
  const record: PostDraftRecord = { ...draft, tenantId, savedAt: Date.now() };
  if (!hasIndexedDb()) {
    return Promise.resolve();
  }
  return openDraftDb()
    .then((database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
      transaction.onabort = () => database.close();
      return transactionOnce(transaction).catch(() => undefined);
    })
    .catch(() => undefined);
}

function removeRecord(tenantId: string): Promise<void> {
  if (!tenantId || !hasIndexedDb()) {
    return Promise.resolve();
  }
  return openDraftDb()
    .then((database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(tenantId);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
      transaction.onabort = () => database.close();
      return transactionOnce(transaction).catch(() => undefined);
    })
    .catch(() => undefined);
}

/**
 * 保存草稿：正文为空时直接丢弃，避免刷新后恢复出一份空草稿。
 * localStorage 镜像同步落盘，保证任何时刻刷新都能回填；
 * IndexedDB 作为长期存储补写，失败不影响表单使用。
 */
export async function writePostDraft(tenantId: string, draft: PostDraftState): Promise<void> {
  if (!tenantId || draft.text.trim().length === 0) {
    await clearPostDraft(tenantId);
    return;
  }
  writeDraftMirror(tenantId, draft);
  await commitRecord(tenantId, draft);
}

export async function clearPostDraft(tenantId: string): Promise<void> {
  removeDraftMirror(tenantId);
  await removeRecord(tenantId);
}
