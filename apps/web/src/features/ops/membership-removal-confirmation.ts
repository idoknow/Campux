export function buildMembershipRemovalConfirmation(options: {
  actorUserId: string;
  targetUserId: string;
  targetLabel: string;
  tenantName: string;
  role: "submitter" | "reviewer" | "admin";
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
