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
  deleteByKeys: (keys: string[]) => Promise<number>;
};

type ClaimStorePersistence = {
  transaction: <T>(callback: (tx: ClaimStoreTransaction) => Promise<T>) => Promise<T>;
  pruneAndCreate: (cutoff: Date, setting: ConvertedGifClaimSetting) => Promise<void>;
  restore: (settings: ConvertedGifClaimSetting[]) => Promise<void>;
};

export class ConvertedGifClaimUnavailableError extends Error {
  constructor() {
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

  async consume(proofs: string[]): Promise<ConvertedGifClaimSetting[]> {
    if (proofs.length === 0) return [];
    const settings = proofs.map((proof) => {
      const expiresAt = Number(proof.split(".", 1)[0]);
      if (!Number.isSafeInteger(expiresAt)) {
        throw new ConvertedGifClaimUnavailableError();
      }
      return buildConvertedGifClaimSetting(proof, expiresAt);
    });
    const keys = settings.map((setting) => setting.key);
    if (new Set(keys).size !== keys.length) {
      throw new ConvertedGifClaimUnavailableError();
    }

    await this.persistence.transaction(async (tx) => {
      const deletedCount = await tx.deleteByKeys(keys);
      if (deletedCount !== keys.length) {
        throw new ConvertedGifClaimUnavailableError();
      }
    });
    return settings;
  }

  async restore(settings: ConvertedGifClaimSetting[]): Promise<void> {
    if (settings.length === 0) return;
    await this.persistence.restore(settings);
  }
}
