import { describe, expect, test } from "bun:test";

import { buildCampuxLoginUrl } from "./campux-login-url";

describe("buildCampuxLoginUrl", () => {
  test("uses the tenant host with the configured public protocol", () => {
    expect(buildCampuxLoginUrl("wall.campux.top", "https://app.campux.top"))
      .toBe("https://wall.campux.top/login");
  });

  test("falls back to the configured web origin when the wall has no host", () => {
    expect(buildCampuxLoginUrl(null, "https://app.campux.top/"))
      .toBe("https://app.campux.top/login");
  });

  test("preserves an explicit protocol on the tenant host", () => {
    expect(buildCampuxLoginUrl("http://192.0.2.8:5180/", "http://app.example.com"))
      .toBe("http://192.0.2.8:5180/login");
  });

  test("falls back instead of accepting tenant paths or HTTPS downgrades", () => {
    expect(buildCampuxLoginUrl("wall.example.com/phishing", "https://app.example.com"))
      .toBe("https://app.example.com/login");
    expect(buildCampuxLoginUrl("//evil.example", "https://app.example.com"))
      .toBe("https://app.example.com/login");
    expect(buildCampuxLoginUrl("http://wall.example.com", "https://app.example.com"))
      .toBe("https://app.example.com/login");
  });

  test("rejects a non-HTTP public web origin", () => {
    expect(() => buildCampuxLoginUrl(null, "javascript:alert(1)"))
      .toThrow("Web 地址");
  });
});
