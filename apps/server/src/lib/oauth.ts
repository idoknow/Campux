import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type OAuthServerSettings = {
  enabled: boolean;
  authorizationCodeTtlMinutes: number;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  pkceRequired: boolean;
  allowPlainPkce: boolean;
  stateKey?: string | null;
};

export const defaultOAuthServerSettings: OAuthServerSettings = {
  enabled: false,
  authorizationCodeTtlMinutes: 10,
  accessTokenTtlMinutes: 60 * 24,
  refreshTokenTtlDays: 30,
  pkceRequired: true,
  allowPlainPkce: false,
};

export function normalizeOAuthServerSettings(value: unknown): OAuthServerSettings {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : defaultOAuthServerSettings.enabled,
    authorizationCodeTtlMinutes: normalizeInteger(record.authorizationCodeTtlMinutes, defaultOAuthServerSettings.authorizationCodeTtlMinutes, 1, 1440),
    accessTokenTtlMinutes: normalizeInteger(record.accessTokenTtlMinutes, defaultOAuthServerSettings.accessTokenTtlMinutes, 5, 10080),
    refreshTokenTtlDays: normalizeInteger(record.refreshTokenTtlDays, defaultOAuthServerSettings.refreshTokenTtlDays, 1, 3650),
    pkceRequired: typeof record.pkceRequired === "boolean" ? record.pkceRequired : defaultOAuthServerSettings.pkceRequired,
    allowPlainPkce: typeof record.allowPlainPkce === "boolean" ? record.allowPlainPkce : defaultOAuthServerSettings.allowPlainPkce,
    stateKey: typeof record.stateKey === "string" && record.stateKey.length > 0 ? String(record.stateKey) : null,
  };
}

import { createCipheriv, createDecipheriv } from "node:crypto";

export function generateStateKey() {
  return randomBytes(32).toString("base64");
}

// Encrypts state using AES-256-GCM. Returns base64url string of iv||authTag||ciphertext
export function encryptState(keyBase64: string | null | undefined, plaintext: string) {
  if (!keyBase64) return plaintext;
  try {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) return plaintext;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const out = Buffer.concat([iv, authTag, ciphertext]);
    return out.toString("base64url");
  } catch (e) {
    return plaintext;
  }
}

// Decrypt state produced by encryptState. Returns plaintext or null on failure.
export function decryptState(keyBase64: string | null | undefined, token: string) {
  if (!keyBase64 || !token) return null;
  try {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) return null;
    const data = Buffer.from(token, "base64url");
    if (data.length < 12 + 16 + 1) return null;
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (e) {
    return null;
  }
}

export function hashOAuthToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function generateOAuthSecret() {
  return randomBytes(32).toString("base64url");
}

export function generateOAuthClientId() {
  return randomBytes(12).toString("base64url");
}

export function isPkceMethodSupported(method: string | null | undefined, allowPlainPkce: boolean) {
  if (!method || method === "S256") {
    return true;
  }
  return allowPlainPkce && method === "plain";
}

export function buildPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkceChallenge(verifier: string, challenge: string, method: string, allowPlainPkce: boolean) {
  if (method === "plain" && !allowPlainPkce) {
    return false;
  }

  const computed = method === "plain" ? verifier : buildPkceChallenge(verifier);
  const computedBytes = Buffer.from(computed);
  const challengeBytes = Buffer.from(challenge);
  if (computedBytes.length !== challengeBytes.length) {
    return false;
  }

  return timingSafeEqual(computedBytes, challengeBytes);
}

export function parseScopeList(value: string | null | undefined) {
  return (value ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinScopeList(scopes: string[]) {
  return Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean))).join(" ");
}

export function appendQueryParams(urlString: string, params: Record<string, string | null | undefined>) {
  const url = new URL(urlString);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function buildOAuthErrorRedirect(redirectUri: string, params: Record<string, string | null | undefined>) {
  return appendQueryParams(redirectUri, params);
}

export function normalizeRedirectUris(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const nextValue = Math.trunc(value);
  if (nextValue < minimum) {
    return minimum;
  }
  if (nextValue > maximum) {
    return maximum;
  }
  return nextValue;
}