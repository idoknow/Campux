import { afterEach, expect, test } from "bun:test";
import { api } from "./api";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function capture() {
  let options: RequestInit = {};
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    options = init;
    return Response.json({ ok: true });
  }) as typeof fetch;
  return () => options;
}
for (const action of ["approve", "reject", "ignore"]) {
  test(`bodyless recall ${action} sends valid JSON`, async () => {
    const request = capture();
    await api(`/api/review/posts/test/recall/${action}`, { method: "POST" });
    expect(request().body).toBe("{}");
    expect(new Headers(request().headers).get("Content-Type")).toBe("application/json");
    expect(request().credentials).toBe("include");
  });
}
test("normalizes lowercase POST with null body", async () => {
  const request = capture();
  await api("/action", { method: "post", body: null });
  expect(request().body).toBe("{}");
});
test("preserves explicit JSON payload", async () => {
  const request = capture();
  await api("/action", { method: "POST", body: '{"silent":true}' });
  expect(request().body).toBe('{"silent":true}');
});
test("preserves multipart body and browser-generated boundary", async () => {
  const request = capture();
  const body = new FormData();
  body.append("text", "hello");
  await api("/upload", { method: "POST", body });
  expect(request().body).toBe(body);
  expect(new Headers(request().headers).has("Content-Type")).toBe(false);
});
for (const method of ["GET", "HEAD", "DELETE"]) {
  test(`does not add body to ${method}`, async () => {
    const request = capture();
    await api("/resource", { method });
    expect(request().body).toBeUndefined();
    expect(new Headers(request().headers).has("Content-Type")).toBe(false);
  });
}
test("preserves explicit non-JSON content type", async () => {
  const request = capture();
  await api("/action", { method: "POST", headers: { "Content-Type": "text/plain" } });
  expect(request().body).toBeUndefined();
  expect(new Headers(request().headers).get("Content-Type")).toBe("text/plain");
});
