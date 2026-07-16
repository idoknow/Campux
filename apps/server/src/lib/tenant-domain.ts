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
  ttl?: number;
  proxied?: boolean;
  comment?: string | null;
};

// Marker written into every DNS record this automation creates. Subdomain
// changes only ever delete records carrying this comment, so an operator's
// hand-made record for a tenant host is never removed by an automated change.
const automationComment = "Created by Campux tenant domain automation";

export class TenantDomainProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantDomainProvisioningError";
  }
}

export class TenantDomainCompensationError extends Error {
  readonly persistenceError: unknown;
  readonly compensationError: unknown;

  constructor(persistenceError: unknown, compensationError: unknown) {
    super("主操作失败，且自动域名补偿也失败");
    this.name = "TenantDomainCompensationError";
    this.persistenceError = persistenceError;
    this.compensationError = compensationError;
  }
}

export async function persistAfterTenantDomainReprovision<T>({
  persist,
  compensate,
}: {
  persist: () => Promise<T>;
  compensate: () => Promise<void>;
}) {
  try {
    return await persist();
  } catch (persistenceError) {
    try {
      await compensate();
    } catch (compensationError) {
      throw new TenantDomainCompensationError(persistenceError, compensationError);
    }
    throw persistenceError;
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

  const zoneId = await resolveZoneId({ config, apiToken, suffix, fetchImpl });

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

// True when `host` sits under the configured auto-domain suffix, i.e. it is a
// host this automation is allowed to create/move/delete in Cloudflare.
export function hostIsUnderTenantSuffix(config: CampuxConfig, host: string | null | undefined) {
  if (!host) return false;
  let suffix: string | null = null;
  try {
    suffix = normalizeDomainSuffix(config.tenantDomains.suffix);
  } catch {
    return false;
  }
  if (!suffix) return false;
  return host === suffix || host.endsWith(`.${suffix}`);
}

// Move a tenant's auto-managed subdomain from `previousHost` to `nextHost`:
// ensure a CNAME exists for the new host, then delete the old auto-created
// record (only when it carries our automation marker). Hosts outside the
// configured suffix are left untouched — an operator can still point a fully
// custom domain at the tenant by hand. Returns the (created/kept) record id
// for the new host, or null when automation is disabled / the new host is not
// managed by us.
export async function reprovisionTenantDomain({
  config,
  previousHost,
  nextHost,
  targetHost,
  fetchImpl = fetch,
}: {
  config: CampuxConfig;
  previousHost: string | null | undefined;
  nextHost: string | null | undefined;
  targetHost: string;
  fetchImpl?: FetchLike;
}) {
  const apiToken = config.tenantDomains.cloudflare.apiToken;
  const suffix = normalizeDomainSuffix(config.tenantDomains.suffix);
  if (!apiToken || !suffix) {
    return null;
  }

  const zoneId = await resolveZoneId({ config, apiToken, suffix, fetchImpl });

  let createdRecordId: string | null = null;

  // 1. Ensure the new host has a CNAME (skip when the new host is a custom
  //    domain outside our suffix, or unchanged).
  if (nextHost && hostIsUnderTenantSuffix(config, nextHost)) {
    if (nextHost === targetHost) {
      throw new TenantDomainProvisioningError("自动域名不能 CNAME 到自己");
    }
    const existing = await findCloudflareRecordByName({ apiToken, zoneId, name: nextHost, fetchImpl });
    if (existing) {
      // Already present (e.g. leftover) — keep it, but make sure it points at
      // the current target.
      createdRecordId = existing.id;
      if (existing.type !== "CNAME" || existing.content !== targetHost) {
        await updateCloudflareRecord({
          apiToken,
          zoneId,
          recordId: existing.id,
          name: nextHost,
          content: targetHost,
          ttl: config.tenantDomains.ttl,
          proxied: config.tenantDomains.proxied,
          fetchImpl,
        });
      }
    } else {
      const record = await createCloudflareCnameRecord({
        apiToken,
        zoneId,
        name: nextHost,
        content: targetHost,
        ttl: config.tenantDomains.ttl,
        proxied: config.tenantDomains.proxied,
        fetchImpl,
      });
      createdRecordId = record.id;
    }
  }

  // 2. Delete the old auto-created record (only ours, only under our suffix,
  //    and only when the host actually changed).
  if (
    previousHost &&
    previousHost !== nextHost &&
    hostIsUnderTenantSuffix(config, previousHost)
  ) {
    const old = await findCloudflareRecordByName({ apiToken, zoneId, name: previousHost, fetchImpl });
    if (old && old.comment === automationComment) {
      await deleteCloudflareRecord({ apiToken, zoneId, recordId: old.id, fetchImpl });
    }
  }

  return createdRecordId;
}

export async function reprovisionTenantDomainWithCompensation({
  config,
  previousHost,
  nextHost,
  targetHost,
  fetchImpl = fetch,
}: {
  config: CampuxConfig;
  previousHost: string | null | undefined;
  nextHost: string | null | undefined;
  targetHost: string;
  fetchImpl?: FetchLike;
}) {
  const apiToken = config.tenantDomains.cloudflare.apiToken;
  const suffix = normalizeDomainSuffix(config.tenantDomains.suffix);
  if (!apiToken || !suffix) {
    return { recordId: null, compensate: async () => {} };
  }

  const zoneId = await resolveZoneId({ config, apiToken, suffix, fetchImpl });
  const managedHosts = [...new Set([previousHost, nextHost]
    .filter((host): host is string => Boolean(host && hostIsUnderTenantSuffix(config, host))))];
  const before = await captureDnsRecords({ apiToken, zoneId, hosts: managedHosts, fetchImpl });

  try {
    const recordId = await reprovisionTenantDomain({
      config,
      previousHost,
      nextHost,
      targetHost,
      fetchImpl,
    });
    const after = await captureDnsRecords({ apiToken, zoneId, hosts: managedHosts, fetchImpl });
    return {
      recordId,
      compensate: () => restoreDnsRecords({
        config,
        apiToken,
        zoneId,
        before,
        expectedCurrent: after,
        fetchImpl,
      }),
    };
  } catch (persistenceError) {
    try {
      await restoreDnsRecords({ config, apiToken, zoneId, before, fetchImpl });
    } catch (compensationError) {
      throw new TenantDomainCompensationError(persistenceError, compensationError);
    }
    throw persistenceError;
  }
}

async function captureDnsRecords({
  apiToken,
  zoneId,
  hosts,
  fetchImpl,
}: {
  apiToken: string;
  zoneId: string;
  hosts: string[];
  fetchImpl: FetchLike;
}) {
  const records = new Map<string, CloudflareDnsRecord | null>();
  for (const host of hosts) {
    records.set(host, await findCloudflareRecordByName({ apiToken, zoneId, name: host, fetchImpl }));
  }
  return records;
}

async function resolveZoneId({
  config,
  apiToken,
  suffix,
  fetchImpl,
}: {
  config: CampuxConfig;
  apiToken: string;
  suffix: string;
  fetchImpl: FetchLike;
}) {
  return config.tenantDomains.cloudflare.zoneId ?? await findCloudflareZoneId({ apiToken, suffix, fetchImpl });
}

async function findCloudflareRecordByName({
  apiToken,
  zoneId,
  name,
  fetchImpl,
}: {
  apiToken: string;
  zoneId: string;
  name: string;
  fetchImpl: FetchLike;
}) {
  const params = new URLSearchParams({ name, per_page: "1" });
  const records = await cloudflareRequest<CloudflareDnsRecord[]>({
    apiToken,
    path: `/zones/${encodeURIComponent(zoneId)}/dns_records?${params}`,
    fetchImpl,
    failurePrefix: "查询 Cloudflare DNS 记录失败",
  });
  return records[0] ?? null;
}

function sameDnsRecord(left: CloudflareDnsRecord | null, right: CloudflareDnsRecord | null) {
  if (left === null || right === null) return left === right;
  return left.name === right.name
    && left.type === right.type
    && left.content === right.content
    && (left.ttl ?? null) === (right.ttl ?? null)
    && (left.proxied ?? null) === (right.proxied ?? null)
    && (left.comment ?? null) === (right.comment ?? null);
}

async function restoreDnsRecords({
  config,
  apiToken,
  zoneId,
  before,
  expectedCurrent,
  fetchImpl,
}: {
  config: CampuxConfig;
  apiToken: string;
  zoneId: string;
  before: Map<string, CloudflareDnsRecord | null>;
  expectedCurrent?: Map<string, CloudflareDnsRecord | null>;
  fetchImpl: FetchLike;
}) {
  for (const [host, original] of before) {
    const current = await findCloudflareRecordByName({ apiToken, zoneId, name: host, fetchImpl });
    const expected = expectedCurrent?.get(host) ?? null;
    if (expectedCurrent && !sameDnsRecord(current, expected)) {
      if (sameDnsRecord(current, original)) continue;
      throw new TenantDomainProvisioningError(`补偿自动域名时检测到并发 DNS 变更：${host}`);
    }
    if (sameDnsRecord(current, original)) continue;

    if (original === null) {
      if (!current || current.comment !== automationComment) {
        throw new TenantDomainProvisioningError(`补偿自动域名时拒绝删除非自动化 DNS 记录：${host}`);
      }
      await deleteCloudflareRecord({ apiToken, zoneId, recordId: current.id, fetchImpl });
      continue;
    }

    if (!expectedCurrent && current && current.comment !== automationComment) {
      throw new TenantDomainProvisioningError(`补偿自动域名时检测到非自动化 DNS 变更：${host}`);
    }
    await writeCloudflareRecordSnapshot({
      config,
      apiToken,
      zoneId,
      ...(current ? { currentRecordId: current.id } : {}),
      record: original,
      fetchImpl,
    });
  }
}

async function writeCloudflareRecordSnapshot({
  config,
  apiToken,
  zoneId,
  currentRecordId,
  record,
  fetchImpl,
}: {
  config: CampuxConfig;
  apiToken: string;
  zoneId: string;
  currentRecordId?: string;
  record: CloudflareDnsRecord;
  fetchImpl: FetchLike;
}) {
  return cloudflareRequest<CloudflareDnsRecord>({
    apiToken,
    path: currentRecordId
      ? `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(currentRecordId)}`
      : `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    fetchImpl,
    failurePrefix: "恢复 Cloudflare DNS 记录失败",
    init: {
      method: currentRecordId ? "PUT" : "POST",
      body: JSON.stringify({
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl ?? config.tenantDomains.ttl,
        proxied: record.proxied ?? config.tenantDomains.proxied,
        comment: record.comment ?? null,
      }),
    },
  });
}

async function updateCloudflareRecord({
  apiToken,
  zoneId,
  recordId,
  name,
  content,
  ttl,
  proxied,
  fetchImpl,
}: {
  apiToken: string;
  zoneId: string;
  recordId: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  fetchImpl: FetchLike;
}) {
  return cloudflareRequest<CloudflareDnsRecord>({
    apiToken,
    path: `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    fetchImpl,
    failurePrefix: "更新 Cloudflare DNS 记录失败",
    init: {
      method: "PUT",
      body: JSON.stringify({ type: "CNAME", name, content, ttl, proxied, comment: automationComment }),
    },
  });
}

async function deleteCloudflareRecord({
  apiToken,
  zoneId,
  recordId,
  fetchImpl,
}: {
  apiToken: string;
  zoneId: string;
  recordId: string;
  fetchImpl: FetchLike;
}) {
  return cloudflareRequest<{ id: string }>({
    apiToken,
    path: `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    fetchImpl,
    failurePrefix: "删除 Cloudflare DNS 记录失败",
    init: { method: "DELETE" },
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
        comment: automationComment,
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
