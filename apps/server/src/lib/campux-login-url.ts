function parseHttpOrigin(value: string): URL | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function isCleanOriginUrl(url: URL) {
  return (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash;
}

export function buildCampuxLoginUrl(tenantHost: string | null | undefined, webOrigin: string): string {
  const fallback = parseHttpOrigin(webOrigin.trim());
  if (!fallback) {
    throw new Error("无法生成 Campux 登录链接：未配置有效的 HTTP(S) Web 地址");
  }

  const rawTenantHost = tenantHost?.trim().replace(/\/+$/, "") || null;
  let tenantUrl: URL | null = null;
  if (rawTenantHost && !/^[\\/]/.test(rawTenantHost)) {
    const hasExplicitProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawTenantHost);
    const candidate = parseHttpOrigin(hasExplicitProtocol
      ? rawTenantHost
      : `${fallback.protocol}//${rawTenantHost}`);
    const downgradesHttps = fallback.protocol === "https:" && candidate?.protocol === "http:";
    if (candidate && isCleanOriginUrl(candidate) && !downgradesHttps) {
      tenantUrl = candidate;
    }
  }

  return `${(tenantUrl ?? fallback).origin}/login`;
}
