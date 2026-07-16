type TenantRole = "submitter" | "reviewer" | "admin";

const membershipRoleLabels: Record<TenantRole, string> = {
  submitter: "投稿用户",
  reviewer: "审核员",
  admin: "管理员",
};

export function buildMembershipRoleChangeConfirmation(options: {
  actorUserId: string;
  targetUserId: string;
  tenantName: string;
  currentRole: TenantRole;
  nextRole: TenantRole;
}) {
  if (
    options.actorUserId !== options.targetUserId
    || options.currentRole !== "admin"
    || options.nextRole === "admin"
  ) {
    return null;
  }

  return `你正在将自己在「${options.tenantName}」的身份从管理员改为${membershipRoleLabels[options.nextRole]}，将失去管理员权限。确认继续？如果这是最后一名管理员，系统会阻止操作。`;
}

export async function refreshMembershipDataAfterRoleChange(options: {
  actorUserId: string;
  targetUserId: string;
  currentRole: TenantRole;
  nextRole: TenantRole;
  refreshAdminData: () => Promise<void>;
  refreshSessionData: () => Promise<void>;
}) {
  const actorLostAdminAccess = options.actorUserId === options.targetUserId
    && options.currentRole === "admin"
    && options.nextRole !== "admin";
  if (actorLostAdminAccess) {
    await options.refreshSessionData();
    return;
  }
  await options.refreshAdminData();
}

export function buildMembershipRemovalConfirmation(options: {
  actorUserId: string;
  targetUserId: string;
  targetLabel: string;
  tenantName: string;
  role: TenantRole;
  roleLabel: string;
}) {
  const lastAdminWarning = options.role === "admin"
    ? "如果这是最后一名管理员，系统会阻止操作。"
    : "";
  if (options.actorUserId === options.targetUserId) {
    return `你正在移除自己在「${options.tenantName}」的${options.roleLabel}身份。确认继续？${lastAdminWarning}`;
  }

  return `确认移除 ${options.targetLabel} 在「${options.tenantName}」的${options.roleLabel}身份？${lastAdminWarning}`;
}
