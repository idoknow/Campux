import { prisma } from "./prisma";
import { normalizeTenantHost } from "./tenant-host";

export type DeployMode = "single" | "multi";

export const DEPLOY_MODE_KEY = "deploy_mode";
export const SETUP_COMPLETED_KEY = "setup_completed";
export const MANAGEMENT_HOST_KEY = "management_host";

// Campux supports two deployment shapes, chosen during first-run setup:
//
// - "single" (自用单墙): one campus wall, the installer owns everything. Tenant
//   mechanics are hidden from the UI; the single wall is auto-selected after
//   login so the operator never sees a wall picker. This is the recommended
//   shape for self-hosting.
// - "multi" (多租户运营平台): the official-service shape. Operators self-register
//   from the management host and each runs their own wall. Wall selection,
//   management-host registration, and the ops panel are all exposed.
//
// The chosen mode is persisted in SystemSetting (no migration needed — it is a
// generic key/value store) and defaults to "multi" for backward compatibility
// with instances that predate the setup wizard.
const DEFAULT_DEPLOY_MODE: DeployMode = "multi";

// Derive a URL-safe, schema-valid tenant slug from a human wall name. The slug
// must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ (>=2 chars). Non-ASCII names (e.g.
// Chinese) collapse to empty, so we fall back to a generated "wall-NNNN".
export function slugFromWallName(name: string, suffix: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base.length >= 2 ? `${base}-${suffix}` : `wall-${suffix}`;
}

// Normalize/validate a deploy-mode string coming from persisted settings.
export function parseDeployMode(value: unknown): DeployMode {
  return value === "single" ? "single" : value === "multi" ? "multi" : DEFAULT_DEPLOY_MODE;
}

export async function getDeployMode(): Promise<DeployMode> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: DEPLOY_MODE_KEY } });
  return parseDeployMode(setting?.value);
}

export async function isSetupCompleted(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: SETUP_COMPLETED_KEY } });
  return setting?.value === true;
}

// First-run setup is offered only on a genuinely fresh instance: setup has not
// been marked complete AND no system operator exists yet. The operator check is
// the real safety gate — it prevents an attacker from re-running setup to mint a
// fresh admin on an instance that already has one but somehow lost the flag.
export async function needsSetup(): Promise<boolean> {
  if (await isSetupCompleted()) {
    return false;
  }
  const operator = await prisma.user.findFirst({ where: { systemRole: "system_operator" }, select: { id: true } });
  return operator === null;
}

export async function getManagementHostSetting(): Promise<string | null> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: MANAGEMENT_HOST_KEY } });
  return typeof setting?.value === "string" && setting.value.length > 0 ? normalizeTenantHost(setting.value) : null;
}

// In single mode there is exactly one wall and the operator should land in it
// directly. Returns the id of the sole active tenant when running single mode,
// otherwise null (multi mode, or single mode that has not created its wall yet).
export async function resolveSingleModeTenantId(): Promise<string | null> {
  if ((await getDeployMode()) !== "single") {
    return null;
  }
  const tenants = await prisma.tenant.findMany({ where: { status: "active" }, select: { id: true }, take: 2 });
  return tenants.length === 1 ? tenants[0]!.id : null;
}
