import { isPrismaKnownRequestError, type TenantRole } from "@campux/db";

export const LAST_TENANT_ADMIN_REMOVAL_MESSAGE = "校园墙必须至少保留一名管理员，请先授权另一名管理员再移除当前管理员";
export const TENANT_ADMIN_REQUIRED_MESSAGE = "校园墙必须至少有一名管理员，请先添加管理员再恢复运行";
export const TENANT_ADMIN_CONCURRENT_UPDATE_MESSAGE = "管理员状态发生并发变化，请刷新后重试";

export class LastTenantAdminRemovalError extends Error {
  constructor() {
    super(LAST_TENANT_ADMIN_REMOVAL_MESSAGE);
    this.name = "LastTenantAdminRemovalError";
  }
}

export class TenantAdminRequiredError extends Error {
  constructor() {
    super(TENANT_ADMIN_REQUIRED_MESSAGE);
    this.name = "TenantAdminRequiredError";
  }
}

export class TransactionSerializationRetriesExhaustedError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(TENANT_ADMIN_CONCURRENT_UPDATE_MESSAGE);
    this.name = "TransactionSerializationRetriesExhaustedError";
    this.cause = cause;
  }
}

export function tenantAdminInvariantErrorResponse(error: unknown) {
  if (error instanceof LastTenantAdminRemovalError) {
    return { statusCode: 409 as const, code: "LAST_TENANT_ADMIN", message: error.message };
  }
  if (error instanceof TenantAdminRequiredError) {
    return { statusCode: 409 as const, code: "TENANT_ADMIN_REQUIRED", message: error.message };
  }
  if (error instanceof TransactionSerializationRetriesExhaustedError) {
    return { statusCode: 409 as const, code: "TENANT_ADMIN_CONCURRENT_UPDATE", message: error.message };
  }
  return null;
}

export function assertTenantActivationAllowed(adminCount: number) {
  if (adminCount < 1) {
    throw new TenantAdminRequiredError();
  }
}

export async function updateTenantAfterAdminCheck<T>({
  countAdmins,
  updateTenant,
}: {
  countAdmins: () => Promise<number>;
  updateTenant: () => Promise<T>;
}) {
  const adminCount = await countAdmins();
  assertTenantActivationAllowed(adminCount);
  return updateTenant();
}

export function assertTenantMembershipRemovalAllowed(options: {
  role: TenantRole;
  adminCount: number;
}) {
  if (options.role === "admin" && options.adminCount <= 1) {
    throw new LastTenantAdminRemovalError();
  }
}

export function assertTenantMembershipRoleChangeAllowed(options: {
  currentRole: TenantRole;
  nextRole: TenantRole;
  adminCount: number;
}) {
  if (options.currentRole === "admin" && options.nextRole !== "admin") {
    assertTenantMembershipRemovalAllowed({ role: options.currentRole, adminCount: options.adminCount });
  }
}

export function buildTenantAdminUserIds(adminUserIds: string[], creatorUserId: string) {
  return [...new Set([...adminUserIds, creatorUserId])];
}

export function isTransactionSerializationFailure(error: unknown) {
  return isPrismaKnownRequestError(error) && error.code === "P2034";
}

export async function retryTransactionSerializationFailures<T>(
  operation: () => Promise<T>,
  isSerializationFailure: (error: unknown) => boolean,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
      if (attempt >= maxAttempts) {
        throw new TransactionSerializationRetriesExhaustedError(error);
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
}
