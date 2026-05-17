export function readQueryParam(key: string, fallback = "") {
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
}

export function readQueryInt(key: string, fallback: number, options: { min?: number; allowed?: readonly number[] } = {}) {
  const raw = readQueryParam(key);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  if (options.allowed && !options.allowed.includes(parsed)) {
    return fallback;
  }
  if (options.min !== undefined && parsed < options.min) {
    return fallback;
  }
  return parsed;
}

export function writeQueryParams(updates: Record<string, string | number | boolean | null | undefined>, mode: "push" | "replace" = "replace") {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl !== currentUrl) {
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", nextUrl);
  }
}
