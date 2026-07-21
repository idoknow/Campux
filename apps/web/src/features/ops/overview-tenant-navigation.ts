type OverviewTenantNavigationState = {
  activeSection: "overview" | "tenants" | "users" | "audit" | "platform";
  selectedTenantId: string;
  tenantKeyword: string;
};

export function buildOverviewTenantNavigation(
  currentState: OverviewTenantNavigationState,
  tenantId: string,
) {
  return {
    ...currentState,
    activeSection: "tenants" as const,
    selectedTenantId: tenantId,
    tenantKeyword: "",
  };
}
