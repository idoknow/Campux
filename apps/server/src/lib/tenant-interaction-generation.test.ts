import { describe, expect, test } from "bun:test";
import { TenantInteractionGenerationFence } from "./tenant-interaction-generation";

describe("TenantInteractionGenerationFence", () => {
  test("invalidates permits synchronously when a tenant is deactivated", () => {
    const fence = new TenantInteractionGenerationFence();
    const permit = fence.snapshot("tenant-a");

    fence.deactivate("tenant-a");

    expect(fence.isCurrent(permit)).toBe(false);
    expect(fence.isActive("tenant-a")).toBe(false);
  });

  test("activation creates a new generation without reviving stale permits", () => {
    const fence = new TenantInteractionGenerationFence();
    const stale = fence.snapshot("tenant-a");
    fence.deactivate("tenant-a");
    fence.activate("tenant-a");
    const current = fence.snapshot("tenant-a");

    expect(fence.isCurrent(stale)).toBe(false);
    expect(fence.isCurrent(current)).toBe(true);
    expect(fence.isActive("tenant-a")).toBe(true);
  });
});
