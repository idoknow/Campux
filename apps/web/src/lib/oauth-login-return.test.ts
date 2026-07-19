import { describe, expect, it } from "bun:test";
import { buildLoginPathWithReturnTo, readLoginReturnTo, readOAuthAuthorizeSearchFromReturnTo } from "./oauth-login-return";

describe("OAuth login return helpers", () => {
  it("preserves the full OAuth authorize URL through the login returnTo parameter", () => {
    const authorizePath = "/oauth/authorize?client_id=campux-app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=profile&state=abc";
    const loginPath = buildLoginPathWithReturnTo(authorizePath);

    expect(loginPath).toBe(`/login?returnTo=${encodeURIComponent(authorizePath)}`);
    expect(readLoginReturnTo(loginPath.slice("/login".length))).toBe(authorizePath);
    expect(readOAuthAuthorizeSearchFromReturnTo(authorizePath)).toBe("?client_id=campux-app&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=profile&state=abc");
  });

  it("rejects external return targets", () => {
    expect(buildLoginPathWithReturnTo("https://evil.example/oauth/authorize")).toBe("/login");
    expect(readLoginReturnTo("?returnTo=https%3A%2F%2Fevil.example%2Foauth%2Fauthorize")).toBeUndefined();
  });
});
