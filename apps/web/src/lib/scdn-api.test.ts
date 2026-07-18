import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ScdnApiError, uploadVideoToGif } from "./scdn-api";

class FakeXMLHttpRequest {
  static latest: FakeXMLHttpRequest | null = null;

  readonly upload = {
    addEventListener: () => undefined,
  };
  readonly listeners = new Map<string, () => void>();
  status = 0;
  statusText = "";
  responseText = "";
  timeout = 0;
  withCredentials = false;
  aborted = false;

  constructor() {
    FakeXMLHttpRequest.latest = this;
  }

  open() {}
  send() {}

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  abort() {
    this.aborted = true;
    this.listeners.get("abort")?.();
  }
}

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");

beforeEach(() => {
  FakeXMLHttpRequest.latest = null;
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: FakeXMLHttpRequest,
  });
});

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, "XMLHttpRequest", originalDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  }
});

describe("uploadVideoToGif", () => {
  test("aborts the active XHR and rejects without waiting for a response", async () => {
    const controller = new AbortController();
    const upload = uploadVideoToGif(
      new File(["video"], "clip.mp4", { type: "video/mp4" }),
      undefined,
      controller.signal,
    );

    controller.abort();

    expect(FakeXMLHttpRequest.latest?.aborted).toBe(true);
    await expect(upload).rejects.toEqual(expect.objectContaining({
      name: ScdnApiError.name,
      message: "上传已取消",
    }));
  });
});
