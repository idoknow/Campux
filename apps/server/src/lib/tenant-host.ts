import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma";

export function normalizeTenantHost(input: string | null | undefined) {
  const raw = input?.trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withProtocol);
    const host = url.host.replace(/\.$/, "");
    return host.length > 0 ? host : null;
  } catch {
    return raw.replace(/^\/+|\/+$/g, "").replace(/\.$/, "") || null;
  }
}

export function requestHostCandidates(request: FastifyRequest) {
  const forwardedHost = request.headers["x-forwarded-host"];
  const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost ?? request.headers.host;
  const normalized = normalizeTenantHost(rawHost?.split(",")[0]);
  if (!normalized) {
    return [];
  }

  const withoutPort = normalized.includes(":") ? (normalized.split(":")[0] ?? normalized) : normalized;
  return Array.from(new Set([normalized, withoutPort]));
}

export async function findManagementHostByRequest(request: FastifyRequest) {
  const candidates = requestHostCandidates(request);
  if (candidates.length === 0) {
    return null;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: {
      key: "management_host",
    },
  });
  const value = typeof setting?.value === "string" ? normalizeTenantHost(setting.value) : null;
  if (!value) {
    return null;
  }

  return candidates.includes(value) ? value : null;
}

export async function findTenantByRequestHost(request: FastifyRequest) {
  const candidates = requestHostCandidates(request);
  if (candidates.length === 0) {
    return null;
  }

  return prisma.tenant.findFirst({
    where: {
      host: {
        in: candidates,
      },
      status: "active",
    },
    include: {
      metadata: {
        where: {
          key: "logo_url",
        },
      },
      aiSettings: {
        select: {
          enabled: true,
        },
      },
      _count: {
        select: {
          botAccounts: true,
          posts: {
            where: {
              status: "pending_approval",
            },
          },
        },
      },
    },
  });
}
