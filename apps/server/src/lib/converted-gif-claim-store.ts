import { createHash } from "node:crypto";
import { convertedGifClaimTtlMs } from "./image-upload-policy";

export const convertedGifClaimSettingPrefix = "converted-gif-claim:v1:";

export type ConvertedGifClaimSetting = {
  key: string;
  value: {
    kind: "converted-gif-claim-v1";
    expiresAt: string;
  };
};

type ClaimStoreTransaction = {
  findExistingKeys(keys: string[]): Promise<string[]>;
  deleteByKeys(keys: string[]): Promise<number>;
};

type ClaimStorePersistence = {
  transaction<T>(callback: (tx: ClaimStoreTransaction) => Promise<T>): Promise<T>;
  pruneAndCreate(cutoff: Date, setting: ConvertedGifClaimSetting): Promise<void>;
};

export class ConvertedGifClaimUnavailableError extends Error {
  constructor(readonly unavailableIndexes: number[] = []) {
    super("converted GIF claim is unavailable");
    this.name = "ConvertedGifClaimUnavailableError";
  }
}

export function buildConvertedGifClaimSetting(
  proof: string,
  expiresAt: number,
): ConvertedGifClaimSetting {
  return {
    key: `${convertedGifClaimSettingPrefix}${createHash("sha256").update(proof).digest("hex")}`,
    value: {
      kind: "converted-gif-claim-v1",
      expiresAt: new Date(expiresAt).toISOString(),
    },
  };
}

export class ConvertedGifClaimStore {
  constructor(private readonly persistence: ClaimStorePersistence) {}

  async issue(proof: string, now = Date.now()): Promise<void> {
    const setting = buildConvertedGifClaimSetting(proof, now + convertedGifClaimTtlMs);
    await this.persistence.pruneAndCreate(
      new Date(now - convertedGifClaimTtlMs),
      setting,
    );
  }

  async assertAvailable(proofs: string[]): Promise<void> {
    if (proofs.length === 0) return;
    await this.persistence.transaction(async (tx) => {
      await this.availableSettingsUsing(proofs, tx);
    });
  }

  async consume(proofs: string[]): Promise<ConvertedGifClaimSetting[]> {
    if (proofs.length === 0) return [];
    return this.persistence.transaction((tx) => this.consumeUsing(proofs, tx));
  }

  async consumeUsing(
    proofs: string[],
    transaction: ClaimStoreTransaction,
  ): Promise<ConvertedGifClaimSetting[]> {
    if (proofs.length === 0) return [];
    const settings = await this.availableSettingsUsing(proofs, transaction);
    const keys = settings.map((setting) => setting.key);
    const deletedCount = await transaction.deleteByKeys(keys);
    if (deletedCount !== keys.length) {
      throw new ConvertedGifClaimUnavailableError(keys.map((_, index) => index));
    }
    return settings;
  }

  private async availableSettingsUsing(
    proofs: string[],
    transaction: ClaimStoreTransaction,
  ): Promise<ConvertedGifClaimSetting[]> {
    const settings = proofs.map((proof, index) => {
      const expiresAt = Number(proof.split(".", 1)[0]);
      if (!Number.isSafeInteger(expiresAt)) {
        throw new ConvertedGifClaimUnavailableError([index]);
      }
      return buildConvertedGifClaimSetting(proof, expiresAt);
    });
    const keys = settings.map((setting) => setting.key);
    const keyCounts = new Map<string, number>();
    for (const key of keys) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
    const duplicateIndexes = keys.flatMap((key, index) => (
      (keyCounts.get(key) ?? 0) > 1 ? [index] : []
    ));
    if (duplicateIndexes.length > 0) {
      throw new ConvertedGifClaimUnavailableError(duplicateIndexes);
    }

    const existingKeys = new Set(await transaction.findExistingKeys(keys));
    const unavailableIndexes = keys.flatMap((key, index) => (
      existingKeys.has(key) ? [] : [index]
    ));
    if (unavailableIndexes.length > 0) {
      throw new ConvertedGifClaimUnavailableError(unavailableIndexes);
    }

    return settings;
  }
}
