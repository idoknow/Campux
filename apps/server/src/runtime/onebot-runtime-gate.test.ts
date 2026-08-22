import { describe, expect, mock, test } from "bun:test";
import { OneBotRuntime } from "./onebot";

describe("OneBot inactive tenant runtime gate", () => {
  test("disconnectTenant closes every tenant connection and removes it from runtime state", () => {
    const closeInactive = mock(() => undefined);
    const closeActive = mock(() => undefined);
    const runtime = new OneBotRuntime({} as never, { info: () => undefined } as never);
    const connections = (runtime as unknown as { connections: Set<unknown> }).connections;
    connections.add({
      socket: { close: closeInactive },
      tenantId: "tenant-paused",
      botAccountId: "bot-paused",
      botQqUin: "10001",
      selfId: null,
    });
    connections.add({
      socket: { close: closeActive },
      tenantId: "tenant-active",
      botAccountId: "bot-active",
      botQqUin: "10002",
      selfId: null,
    });

    runtime.disconnectTenant("tenant-paused");

    expect(closeInactive).toHaveBeenCalledWith(1008, "tenant inactive");
    expect(closeActive).not.toHaveBeenCalled();
    expect(connections.size).toBe(1);
  });

  test("disconnectTenant cancels delayed interaction buffers and clears drafts", () => {
    const runtime = new OneBotRuntime({} as never, { info: () => undefined } as never);
    const rejectPendingAction = mock(() => undefined);
    const state = runtime as unknown as {
      privateForwardBuffers: Map<string, { tenantId: string; timer: Timer | null }>;
      privatePostAggregateBuffers: Map<string, { tenantId: string; timer: Timer | null; typingTimer: Timer | null }>;
      privatePostDrafts: Map<string, { tenantId: string }>;
      pendingFriendRequestFlags: Set<string>;
      pendingFriendRequestTimers: Map<string, { tenantId: string; timer: Timer }>;
      pendingActions: Map<string, { tenantId: string; timer: Timer; reject(error: Error): void }>;
    };
    state.privateForwardBuffers.set("forward", { tenantId: "tenant-paused", timer: setTimeout(() => undefined, 60_000) });
    state.privatePostAggregateBuffers.set("aggregate", {
      tenantId: "tenant-paused",
      timer: setTimeout(() => undefined, 60_000),
      typingTimer: setTimeout(() => undefined, 60_000),
    });
    state.privatePostDrafts.set("draft", { tenantId: "tenant-paused" });
    state.pendingFriendRequestFlags.add("friend-flag");
    state.pendingFriendRequestTimers.set("friend-flag", { tenantId: "tenant-paused", timer: setTimeout(() => undefined, 60_000) });
    state.pendingActions.set("echo", {
      tenantId: "tenant-paused",
      timer: setTimeout(() => undefined, 60_000),
      reject: rejectPendingAction,
    });

    runtime.disconnectTenant("tenant-paused");

    expect(state.privateForwardBuffers.size).toBe(0);
    expect(state.privatePostAggregateBuffers.size).toBe(0);
    expect(state.privatePostDrafts.size).toBe(0);
    expect(state.pendingFriendRequestFlags.size).toBe(0);
    expect(state.pendingFriendRequestTimers.size).toBe(0);
    expect(state.pendingActions.size).toBe(0);
    expect(rejectPendingAction).toHaveBeenCalledTimes(1);
  });

  test("an action awaiting its tenant gate cannot send after deactivation", async () => {
    const runtime = new OneBotRuntime({} as never, { info: () => undefined } as never);
    const send = mock(() => undefined);
    let releaseGate!: () => void;
    let enteredGate!: () => void;
    const gateEntered = new Promise<void>((resolve) => {
      enteredGate = resolve;
    });
    const gateRelease = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const state = runtime as unknown as {
      connections: Set<unknown>;
      interactionFence: {
        snapshot(tenantId: string): { tenantId: string; generation: number };
      };
      ensureConnectionTenantActive(): Promise<boolean>;
    };
    const permit = state.interactionFence.snapshot("tenant-paused");
    state.connections.add({
      socket: { readyState: 1, send, close: () => undefined },
      tenantId: "tenant-paused",
      botAccountId: "bot-paused",
      selfId: "10001",
      permit,
    });
    state.ensureConnectionTenantActive = async () => {
      enteredGate();
      await gateRelease;
      return true;
    };

    const action = runtime.callAction("10001", "send_private_msg", {});
    await gateEntered;
    runtime.disconnectTenant("tenant-paused");
    releaseGate();

    await expect(action).rejects.toThrow("校园墙已暂停或归档");
    expect(send).not.toHaveBeenCalled();
  });
});
