import { describe, expect, test } from "bun:test";
import type { CampuxConfig } from "@campux/config";
import {
  buildTenantDomainHost,
  hostIsUnderTenantSuffix,
  provisionTenantDomain,
  reprovisionTenantDomain,
  resolveDnsTargetHost,
  TenantDomainProvisioningError,
} from "./tenant-domain";

function testConfig(overrides: Partial<CampuxConfig["tenantDomains"]> = {}) {
  return {
    tenantDomains: {
      suffix: "campux.top",
      targetHost: "app.campux.top",
      proxied: true,
      ttl: 1,
      cloudflare: {
        apiToken: "cf-token",
        zoneId: undefined,
      },
      ...overrides,
    },
  } as CampuxConfig;
}

describe("buildTenantDomainHost", () => {
  test("builds slug-based subdomains", () => {
    expect(buildTenantDomainHost("wall-abc123", "campux.top")).toBe("wall-abc123.campux.top");
    expect(buildTenantDomainHost("wall-abc123", ".campux.top.")).toBe("wall-abc123.campux.top");
    expect(buildTenantDomainHost("wall-abc123", "*.campux.top")).toBe("wall-abc123.campux.top");
  });
});

describe("resolveDnsTargetHost", () => {
  test("accepts hosts and origins but rejects ports", () => {
    expect(resolveDnsTargetHost("https://app.campux.top/path")).toBe("app.campux.top");
    expect(() => resolveDnsTargetHost("http://localhost:8989")).toThrow(TenantDomainProvisioningError);
  });
});

describe("provisionTenantDomain", () => {
  test("looks up the zone by suffix and creates a proxied CNAME", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = (async (input, init) => {
      requests.push(init === undefined ? { url: String(input) } : { url: String(input), init });
      if (String(input).includes("/zones?")) {
        return Response.json({
          success: true,
          result: [{ id: "zone-123", name: "campux.top" }],
        });
      }
      return Response.json({
        success: true,
        result: {
          id: "record-123",
          name: "wall-abc123.campux.top",
          type: "CNAME",
          content: "app.campux.top",
        },
      });
    }) as typeof fetch;

    const record = await provisionTenantDomain({
      config: testConfig(),
      host: "wall-abc123.campux.top",
      targetHost: "app.campux.top",
      fetchImpl: mockFetch,
    });

    expect(record?.id).toBe("record-123");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toContain("/zones?");
    expect(requests[0]?.url).toContain("name=campux.top");
    expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe("Bearer cf-token");
    expect(requests[1]?.url).toBe("https://api.cloudflare.com/client/v4/zones/zone-123/dns_records");
    expect(JSON.parse(requests[1]?.init?.body as string)).toEqual({
      type: "CNAME",
      name: "wall-abc123.campux.top",
      content: "app.campux.top",
      ttl: 1,
      proxied: true,
      comment: "Created by Campux tenant domain automation",
    });
  });

  test("uses a configured zone id without listing zones", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch = (async (input, init) => {
      requests.push(init === undefined ? { url: String(input) } : { url: String(input), init });
      return Response.json({
        success: true,
        result: {
          id: "record-456",
          name: "wall-def456.campux.top",
          type: "CNAME",
          content: "app.campux.top",
        },
      });
    }) as typeof fetch;

    await provisionTenantDomain({
      config: testConfig({ cloudflare: { apiToken: "cf-token", zoneId: "known-zone" } }),
      host: "wall-def456.campux.top",
      targetHost: "app.campux.top",
      fetchImpl: mockFetch,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.cloudflare.com/client/v4/zones/known-zone/dns_records");
  });
});

describe("hostIsUnderTenantSuffix", () => {
  test("matches subdomains of the configured suffix only", () => {
    const config = testConfig();
    expect(hostIsUnderTenantSuffix(config, "gzhu.campux.top")).toBe(true);
    expect(hostIsUnderTenantSuffix(config, "campux.top")).toBe(true);
    expect(hostIsUnderTenantSuffix(config, "wall.example.com")).toBe(false);
    expect(hostIsUnderTenantSuffix(config, null)).toBe(false);
    expect(hostIsUnderTenantSuffix(config, "")).toBe(false);
  });
});

describe("reprovisionTenantDomain", () => {
  const configWithZone = () => testConfig({ cloudflare: { apiToken: "cf-token", zoneId: "zone-1" } });

  function mockCf(handlers: {
    lookup?: (name: string) => unknown;
  }) {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockFetch = (async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (method === "GET" && url.includes("/dns_records?")) {
        const name = new URL(url).searchParams.get("name") ?? "";
        const result = handlers.lookup ? handlers.lookup(name) : null;
        return Response.json({ success: true, result: result ? [result] : [] });
      }
      // create / update / delete all return a record-ish object
      return Response.json({ success: true, result: { id: "new-record", name: "x", type: "CNAME", content: "app.campux.top" } });
    }) as typeof fetch;
    return { requests, mockFetch };
  }

  test("creates the new CNAME and deletes the old auto-created one", async () => {
    const { requests, mockFetch } = mockCf({
      lookup: (name) =>
        name === "old.campux.top"
          ? { id: "old-rec", name, type: "CNAME", content: "app.campux.top", comment: "Created by Campux tenant domain automation" }
          : null,
    });

    const recordId = await reprovisionTenantDomain({
      config: configWithZone(),
      previousHost: "old.campux.top",
      nextHost: "new.campux.top",
      targetHost: "app.campux.top",
      fetchImpl: mockFetch,
    });

    expect(recordId).toBe("new-record");
    // lookup(new) -> create(new) -> lookup(old) -> delete(old)
    const creates = requests.filter((r) => r.method === "POST");
    const deletes = requests.filter((r) => r.method === "DELETE");
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toMatchObject({ type: "CNAME", name: "new.campux.top", content: "app.campux.top" });
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.url).toContain("/dns_records/old-rec");
  });

  test("does NOT delete an old record lacking the automation marker", async () => {
    const { requests, mockFetch } = mockCf({
      lookup: (name) =>
        name === "old.campux.top"
          ? { id: "hand-rec", name, type: "CNAME", content: "somewhere.else", comment: "hand made" }
          : null,
    });

    await reprovisionTenantDomain({
      config: configWithZone(),
      previousHost: "old.campux.top",
      nextHost: "new.campux.top",
      targetHost: "app.campux.top",
      fetchImpl: mockFetch,
    });

    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(0);
  });

  test("skips CNAME creation when moving to a fully custom domain, still cleans old", async () => {
    const { requests, mockFetch } = mockCf({
      lookup: (name) =>
        name === "old.campux.top"
          ? { id: "old-rec", name, type: "CNAME", content: "app.campux.top", comment: "Created by Campux tenant domain automation" }
          : null,
    });

    const recordId = await reprovisionTenantDomain({
      config: configWithZone(),
      previousHost: "old.campux.top",
      nextHost: "wall.example.com", // custom, outside suffix
      targetHost: "app.campux.top",
      fetchImpl: mockFetch,
    });

    expect(recordId).toBeNull();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  test("returns null and does nothing when automation disabled", async () => {
    const { requests, mockFetch } = mockCf({});
    const recordId = await reprovisionTenantDomain({
      config: testConfig({ cloudflare: { apiToken: undefined, zoneId: undefined } }),
      previousHost: "old.campux.top",
      nextHost: "new.campux.top",
      targetHost: "app.campux.top",
      fetchImpl: mockFetch,
    });
    expect(recordId).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
