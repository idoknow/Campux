import { describe, expect, test } from "bun:test";

import { PrivateRegistrationCoordinator, runWithUniqueConflictRetry } from "./private-registration";

describe("PrivateRegistrationCoordinator", () => {
  test("coalesces concurrent first messages until the leader finishes the registration notice", async () => {
    const coordinator = new PrivateRegistrationCoordinator<{ password: string | null; noticeSent: boolean }>();
    let registrations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const register = async () => {
      registrations += 1;
      await gate;
      return { password: "InitPass9", noticeSent: true };
    };

    const first = coordinator.run("bot:user", register);
    const second = coordinator.run("bot:user", register);
    release();

    expect(await first).toEqual({ result: { password: "InitPass9", noticeSent: true }, shouldAnnounce: true, coalesced: false, lostDatabaseRace: false });
    expect(await second).toEqual({ result: { password: "InitPass9", noticeSent: true }, shouldAnnounce: false, coalesced: true, lostDatabaseRace: false });
    expect(registrations).toBe(1);
  });

  test("runs registration again after the previous attempt settles", async () => {
    const coordinator = new PrivateRegistrationCoordinator<number>();
    let registrations = 0;
    const register = async () => ++registrations;

    expect(await coordinator.run("bot:user", register)).toEqual({ result: 1, shouldAnnounce: true, coalesced: false, lostDatabaseRace: false });
    expect(await coordinator.run("bot:user", register)).toEqual({ result: 2, shouldAnnounce: true, coalesced: false, lostDatabaseRace: false });
  });

  test("treats a database race loser as coalesced so another process owns the notice", async () => {
    const coordinator = new PrivateRegistrationCoordinator<{ alreadyHadTenantAccess: boolean }>();
    let attempts = 0;
    const outcome = await coordinator.run("tenant:user", async () => {
      attempts += 1;
      if (attempts === 1) {
        throw { code: "P2002", message: "unique conflict" };
      }
      return { alreadyHadTenantAccess: true };
    });

    expect(outcome).toEqual({
      result: { alreadyHadTenantAccess: true },
      shouldAnnounce: false,
      coalesced: true,
      lostDatabaseRace: true,
    });
  });

  test("retries one database unique conflict and returns the persisted outcome", async () => {
    let attempts = 0;
    const result = await runWithUniqueConflictRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw { code: "P2002", message: "unique conflict" };
      }
      return { alreadyHadTenantAccess: true };
    });

    expect(attempts).toBe(2);
    expect(result).toEqual({ alreadyHadTenantAccess: true });
  });

  test("does not retry unrelated database errors", async () => {
    let attempts = 0;
    await expect(runWithUniqueConflictRetry(async () => {
      attempts += 1;
      throw { code: "P2025", message: "not found" };
    })).rejects.toEqual({ code: "P2025", message: "not found" });
    expect(attempts).toBe(1);
  });
});
