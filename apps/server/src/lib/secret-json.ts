import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@campux/db";

type EncryptedJsonEnvelope = {
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

export function encryptJson(value: unknown): Prisma.InputJsonValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope: EncryptedJsonEnvelope = {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
  return envelope;
}

export function decryptJson(value: Prisma.JsonValue): unknown {
  if (!isEncryptedJsonEnvelope(value)) {
    return value;
  }

  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(value.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function getKey() {
  const secret = process.env.CAMPUX_BOT_SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? null : process.env.DATABASE_URL);
  if (!secret) {
    throw new Error("CAMPUX_BOT_SESSION_SECRET is required to store Bot session cookies in production");
  }
  return createHash("sha256").update(secret).digest();
}

export function ensureBotSessionSecretConfigured() {
  getKey();
}

function isEncryptedJsonEnvelope(value: Prisma.JsonValue): value is EncryptedJsonEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.algorithm === "aes-256-gcm" &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.ciphertext === "string"
  );
}
