export type TenantInteractionPermit = {
  tenantId: string;
  generation: number;
};

type TenantInteractionState = {
  active: boolean;
  generation: number;
};

/** Synchronous in-process fence for OneBot socket/action await boundaries. */
export class TenantInteractionGenerationFence {
  private readonly states = new Map<string, TenantInteractionState>();

  snapshot(tenantId: string): TenantInteractionPermit {
    return { tenantId, generation: this.state(tenantId).generation };
  }

  isCurrent(permit: TenantInteractionPermit) {
    const state = this.state(permit.tenantId);
    return state.active && state.generation === permit.generation;
  }

  isActive(tenantId: string) {
    return this.state(tenantId).active;
  }

  deactivate(tenantId: string) {
    const state = this.state(tenantId);
    this.states.set(tenantId, { active: false, generation: state.generation + 1 });
  }

  activate(tenantId: string) {
    const state = this.state(tenantId);
    this.states.set(tenantId, { active: true, generation: state.generation + 1 });
  }

  private state(tenantId: string): TenantInteractionState {
    return this.states.get(tenantId) ?? { active: true, generation: 0 };
  }
}
