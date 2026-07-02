import { describe, expect, test } from "bun:test";
import type { CampuxConfig } from "@campux/config";
import {
  buildTenantDomainHost,
  provisionTenantDomain,
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
