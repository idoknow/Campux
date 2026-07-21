import { describe, expect, test } from "bun:test";
import { buildOverviewTenantNavigation } from "./overview-tenant-navigation";

describe("buildOverviewTenantNavigation", () => {
  test("clears a retained tenant search before opening the clicked tenant", () => {
    expect(buildOverviewTenantNavigation({
      activeSection: "overview",
      selectedTenantId: "tenant-1",
      tenantKeyword: "first-wall",
    }, "tenant-2")).toEqual({
      activeSection: "tenants",
      selectedTenantId: "tenant-2",
      tenantKeyword: "",
    });
  });
});
