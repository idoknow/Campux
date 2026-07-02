import type { CampuxConfig } from "@campux/config";
import { normalizeTenantHost } from "./tenant-host";

const cloudflareApiBaseUrl = "https://api.cloudflare.com/client/v4";

type FetchLike = typeof fetch;

type CloudflareEnvelope<T> = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
};

type CloudflareZone = {
  id: string;
  name: string;
};

type CloudflareDnsRecord = {
  id: string;
  name: string;
  type: string;
  content: string;
};

export class TenantDomainProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantDomainProvisioningError";
  }
}

export function tenantDomainAutomationEnabled(config: CampuxConfig) {
  return Boolean(config.tenantDomains.suffix && config.tenantDomains.cloudflare.apiToken);
}

export function buildTenantDomainHost(slug: string, suffix: string | undefined) {
  const normalizedSuffix = normalizeDomainSuffix(suffix);
  return normalizedSuffix ? `${slug}.${normalizedSuffix}` : null;
}

export function normalizeDomainSuffix(input: string | undefined) {
  const raw = input?.trim().replace(/^\*\./, "").replace(/^\./, "");
  return normalizeDnsHostname(raw, "域名后缀");
}

export function resolveDnsTargetHost(input: string | null | undefined) {
  return normalizeDnsHostname(input ?? undefined, "DNS CNAME 目标");
}

function normalizeDnsHostname(input: string | undefined, label: string) {
  const host = normalizeTenantHost(input);
  if (!host) {
    return null;
  }
  if (host.includes(":")) {
    throw new TenantDomainProvisioningError(`${label} 不能包含端口：${host}`);
  }
  if (host.length > 253) {
    throw new TenantDomainProvisioningError(`${label} 不能超过 253 个字符`);
  }
  return host;
}

export async function provisionTenantDomain({
  config,
  host,
  targetHost,
  fetchImpl = fetch,
}: {
  config: CampuxConfig;
  host: string;
  targetHost: string;
  fetchImpl?: FetchLike;
}) {
  const apiToken = config.tenantDomains.cloudflare.apiToken;
  const suffix = normalizeDomainSuffix(config.tenantDomains.suffix);
  if (!apiToken || !suffix) {
    return null;
  }

  if (host === targetHost) {
    throw new TenantDomainProvisioningError("自动域名不能 CNAME 到自己");
  }

  const zoneId = config.tenantDomains.cloudflare.zoneId ?? await findCloudflareZoneId({
    apiToken,
    suffix,
    fetchImpl,
  });

  return createCloudflareCnameRecord({
    apiToken,
    zoneId,
    name: host,
    content: targetHost,
    ttl: config.tenantDomains.ttl,
    proxied: config.tenantDomains.proxied,
    fetchImpl,
  });
}

async function findCloudflareZoneId({
  apiToken,
  suffix,
  fetchImpl,
}: {
  apiToken: string;
  suffix: string;
  fetchImpl: FetchLike;
}) {
  const params = new URLSearchParams({
    name: suffix,
    status: "active",
    per_page: "1",
  });
  const zones = await cloudflareRequest<CloudflareZone[]>({
    apiToken,
    path: `/zones?${params}`,
    fetchImpl,
    failurePrefix: "查询 Cloudflare Zone 失败",
  });
  const zone = zones.find((item) => item.name === suffix) ?? zones[0];
  if (!zone) {
    throw new TenantDomainProvisioningError(`Cloudflare 中没有找到可用 Zone：${suffix}`);
  }
  return zone.id;
}

async function createCloudflareCnameRecord({
  apiToken,
  zoneId,
  name,
  content,
  ttl,
  proxied,
  fetchImpl,
}: {
  apiToken: string;
  zoneId: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  fetchImpl: FetchLike;
}) {
  return cloudflareRequest<CloudflareDnsRecord>({
    apiToken,
    path: `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    fetchImpl,
    failurePrefix: "创建 Cloudflare DNS 记录失败",
    init: {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name,
        content,
        ttl,
        proxied,
        comment: "Created by Campux tenant domain automation",
      }),
    },
  });
}

async function cloudflareRequest<T>({
  apiToken,
  path,
  init,
  fetchImpl,
  failurePrefix,
}: {
  apiToken: string;
  path: string;
  init?: RequestInit;
  fetchImpl: FetchLike;
  failurePrefix: string;
}) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiToken}`);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetchImpl(`${cloudflareApiBaseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await parseCloudflarePayload<T>(response, failurePrefix);
  return payload;
}

async function parseCloudflarePayload<T>(response: Response, failurePrefix: string) {
  let payload: CloudflareEnvelope<T>;
  try {
    payload = await response.json() as CloudflareEnvelope<T>;
  } catch {
    throw new TenantDomainProvisioningError(`${failurePrefix}：Cloudflare 返回了无法解析的响应`);
  }

  if (!response.ok || !payload.success || payload.result === undefined) {
    const details = payload.errors?.map((error) => error.message).filter(Boolean).join("；") || response.statusText || `HTTP ${response.status}`;
    throw new TenantDomainProvisioningError(`${failurePrefix}：${details}`);
  }

  return payload.result;
}
