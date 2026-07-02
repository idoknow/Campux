import type { FastifyBaseLogger } from "fastify";
import type { CampuxConfig } from "@campux/config";
import { prisma } from "../lib/prisma";
import { writeAuditLog } from "../lib/audit";
import { sendEmail } from "../lib/email";

// A wall that, 30 days after creation, still has never connected a bot
// (readyAt === null) and has at most this many members is considered abandoned.
const INACTIVE_DAYS = 30;
const MAX_MEMBERS = 2;
// After the first warning, wait this many days before archiving, giving the
// operator a grace window to finish setup or react to the email.
const WARNING_GRACE_DAYS = 7;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

type LifecycleDeps = {
  logger: FastifyBaseLogger;
  config: CampuxConfig;
  prisma?: TenantLifecycleStore;
  writeAuditLog?: typeof writeAuditLog;
  sendEmail?: typeof sendEmail;
  now?: () => Date;
};

type TenantLifecycleStore = {
  tenant: {
    findMany(args: unknown): Promise<TenantLifecycleCandidate[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  tenantMembership: {
    findMany(args: unknown): Promise<Array<{ user: { email: string | null } }>>;
  };
};

type TenantLifecycleCandidate = {
  id: string;
  name: string;
  archiveWarningAt: Date | null;
  _count: { memberships: number };
};

type ResolvedLifecycleDeps = LifecycleDeps & {
  prisma: TenantLifecycleStore;
  writeAuditLog: typeof writeAuditLog;
  sendEmail: typeof sendEmail;
  now: () => Date;
};

function resolveDeps(deps: LifecycleDeps): ResolvedLifecycleDeps {
  return {
    ...deps,
    prisma: (deps.prisma ?? prisma) as TenantLifecycleStore,
    writeAuditLog: deps.writeAuditLog ?? writeAuditLog,
    sendEmail: deps.sendEmail ?? sendEmail,
    now: deps.now ?? (() => new Date()),
  };
}

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * DAY_MS);
}

async function notifyOperators(deps: ResolvedLifecycleDeps, tenant: { id: string; name: string }, kind: "warning" | "archived") {
  // Email the wall's admins (operators). Bots are offline by definition for
  // these walls, so email is the only reliable channel.
  const admins = await deps.prisma.tenantMembership.findMany({
    where: { tenantId: tenant.id, role: "admin" },
    select: { user: { select: { email: true } } },
  });
  const emails = [...new Set(admins.map((m) => m.user.email).filter((email): email is string => Boolean(email)))];
  if (emails.length === 0) {
    return;
  }

  const subject = kind === "warning"
    ? `【Campux】校园墙「${tenant.name}」即将被自动存档`
    : `【Campux】校园墙「${tenant.name}」已被自动存档`;
  const body = kind === "warning"
    ? `你的校园墙「${tenant.name}」创建超过 ${INACTIVE_DAYS} 天，仍未成功接入墙号机器人，注册用户也不足 ${MAX_MEMBERS + 1} 人。\n如果 ${WARNING_GRACE_DAYS} 天内仍未完成机器人接入，系统会自动将其存档。\n请登录 Campux 在引导中完成墙号机器人接入。`
    : `你的校园墙「${tenant.name}」因创建超过 ${INACTIVE_DAYS} 天仍未接入墙号机器人，已被自动存档。\n如需继续使用，请联系系统运维恢复。`;
  const html = body
    .split("\n")
    .map((line) => `<p>${line}</p>`)
    .join("");

  for (const email of emails) {
    try {
      await deps.sendEmail(deps.config, { to: email, subject, html, text: body });
    } catch (error) {
      deps.logger.warn({ error, tenantId: tenant.id, email }, "failed to send tenant lifecycle email");
    }
  }
}

export async function runTenantLifecycleSweep(rawDeps: LifecycleDeps) {
  const deps = resolveDeps(rawDeps);
  const now = deps.now();
  const candidates = await deps.prisma.tenant.findMany({
    where: {
      status: "active",
      readyAt: null,
      createdAt: { lte: daysAgo(now, INACTIVE_DAYS) },
    },
    select: {
      id: true,
      name: true,
      archiveWarningAt: true,
      _count: { select: { memberships: true } },
    },
  });

  for (const tenant of candidates) {
    if (tenant.archiveWarningAt !== null) {
      if (tenant.archiveWarningAt <= daysAgo(now, WARNING_GRACE_DAYS)) {
        await deps.prisma.tenant.update({ where: { id: tenant.id }, data: { status: "archived" } });
        await deps.writeAuditLog({
          tenantId: tenant.id,
          actorId: null,
          action: "tenant.archive.auto",
          targetType: "tenant",
          targetId: tenant.id,
          detail: { reason: "inactive_no_bot", memberCount: tenant._count.memberships },
        }).catch((error) => deps.logger.warn({ error, tenantId: tenant.id }, "failed to write archive auto audit log"));
        await notifyOperators(deps, tenant, "archived");
        deps.logger.info({ tenantId: tenant.id }, "tenant auto archived");
      }
      continue;
    }

    // Membership count only gates the first warning. Once an operator has seen
    // a warning, honor the 7-day deadline unless a bot actually connects.
    if (tenant._count.memberships > MAX_MEMBERS) {
      continue;
    }

    // First time qualifying: warn now, archive after the grace window.
    await deps.prisma.tenant.update({ where: { id: tenant.id }, data: { archiveWarningAt: now } });
    await deps.writeAuditLog({
      tenantId: tenant.id,
      actorId: null,
      action: "tenant.archive.warn",
      targetType: "tenant",
      targetId: tenant.id,
      detail: { reason: "inactive_no_bot", memberCount: tenant._count.memberships },
    }).catch((error) => deps.logger.warn({ error, tenantId: tenant.id }, "failed to write archive warn audit log"));
    await notifyOperators(deps, tenant, "warning");
    deps.logger.info({ tenantId: tenant.id }, "tenant archive warning issued");
  }
}

export function registerTenantLifecycleScheduler(deps: LifecycleDeps) {
  const timer = setInterval(() => {
    void runTenantLifecycleSweep(deps).catch((error) => deps.logger.warn({ error }, "tenant lifecycle sweep failed"));
  }, RUN_INTERVAL_MS);
  void runTenantLifecycleSweep(deps).catch((error) => deps.logger.warn({ error }, "tenant lifecycle sweep failed"));
  return () => clearInterval(timer);
}
