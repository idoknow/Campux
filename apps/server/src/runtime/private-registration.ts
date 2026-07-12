function isUniqueConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function runWithUniqueConflictRetry<Result>(
  operation: () => Promise<Result>,
  onConflict?: () => void,
): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    if (!isUniqueConflict(error)) {
      throw error;
    }
    onConflict?.();
    return operation();
  }
}

type RegistrationExecution<Result> = {
  result: Result;
  lostDatabaseRace: boolean;
};

export class PrivateRegistrationCoordinator<Result> {
  private readonly inFlight = new Map<string, Promise<RegistrationExecution<Result>>>();

  async run(
    key: string,
    register: () => Promise<Result>,
  ): Promise<{ result: Result; shouldAnnounce: boolean; coalesced: boolean; lostDatabaseRace: boolean }> {
    const existing = this.inFlight.get(key);
    if (existing) {
      const execution = await existing;
      return {
        result: execution.result,
        shouldAnnounce: false,
        coalesced: true,
        lostDatabaseRace: execution.lostDatabaseRace,
      };
    }

    const task = (async () => {
      let lostDatabaseRace = false;
      const result = await runWithUniqueConflictRetry(register, () => {
        lostDatabaseRace = true;
      });
      return { result, lostDatabaseRace };
    })();
    this.inFlight.set(key, task);
    try {
      const execution = await task;
      return {
        result: execution.result,
        shouldAnnounce: !execution.lostDatabaseRace,
        coalesced: execution.lostDatabaseRace,
        lostDatabaseRace: execution.lostDatabaseRace,
      };
    } finally {
      if (this.inFlight.get(key) === task) {
        this.inFlight.delete(key);
      }
    }
  }
}
