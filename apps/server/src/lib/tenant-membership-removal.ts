export const LAST_TENANT_ADMIN_REMOVAL_MESSAGE = "校园墙必须至少保留一名管理员，请先授权另一名管理员再移除当前管理员";

export class LastTenantAdminRemovalError extends Error {
  constructor() {
    super(LAST_TENANT_ADMIN_REMOVAL_MESSAGE);
    this.name = "LastTenantAdminRemovalError";
  }
}

export function assertTenantMembershipRemovalAllowed(options: {
  role: "submitter" | "reviewer" | "admin";
  adminCount: number;
}) {
  if (options.role === "admin" && options.adminCount <= 1) {
    throw new LastTenantAdminRemovalError();
  }
}

export function assertTenantMembershipRoleChangeAllowed(options: {
  currentRole: "submitter" | "reviewer" | "admin";
  nextRole: "submitter" | "reviewer" | "admin";
  adminCount: number;
}) {
  if (options.currentRole === "admin" && options.nextRole !== "admin") {
    assertTenantMembershipRemovalAllowed({ role: options.currentRole, adminCount: options.adminCount });
  }
}

export function buildTenantAdminUserIds(adminUserIds: string[], creatorUserId: string) {
  return [...new Set([...adminUserIds, creatorUserId])];
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
      if (attempt >= maxAttempts || !isSerializationFailure(error)) {
        throw error;
      }
    }
  }
}
