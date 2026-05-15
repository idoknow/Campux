import { hash, verify } from "@node-rs/argon2";

const legacyPasswordOptions = {
  algorithm: 2,
  memoryCost: 64 * 1024,
  timeCost: 1,
  parallelism: 2,
  outputLen: 32,
} as const;

export async function hashPassword(password: string) {
  return hash(password, legacyPasswordOptions);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return verify(passwordHash, password);
}
