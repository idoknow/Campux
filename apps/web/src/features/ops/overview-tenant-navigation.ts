import type { OpsSection } from "./ops-section";

type OverviewTenantNavigationState = {
  activeSection: OpsSection;
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
