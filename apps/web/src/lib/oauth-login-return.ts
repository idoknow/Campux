export function isSafeInternalPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return false;
  }
  try {
    const url = new URL(value, "https://campux.local");
    return url.origin === "https://campux.local";
  } catch {
    return false;
  }
}

export function buildLoginPathWithReturnTo(returnTo: string) {
  if (!isSafeInternalPath(returnTo)) {
    return "/login";
  }
  const params = new URLSearchParams({ returnTo });
  return `/login?${params}`;
}

export function readLoginReturnTo(search: string): string | undefined {
  const returnTo = new URLSearchParams(search).get("returnTo");
  if (typeof returnTo !== "string" || !isSafeInternalPath(returnTo)) {
    return undefined;
  }
  return returnTo;
}

export function readOAuthAuthorizeSearchFromReturnTo(returnTo: string | null | undefined) {
  const candidate = typeof returnTo === "string" ? returnTo : "";
  if (!isSafeInternalPath(candidate)) {
    return null;
  }
  const url = new URL(candidate, "https://campux.local");
  if (url.pathname.replace(/\/+$/, "") !== "/oauth/authorize") {
    return null;
  }
  return url.search;
}
