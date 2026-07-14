import { createHmac, timingSafeEqual } from "node:crypto";
import type { CampuxConfig } from "@campux/config";

const forumMediaLifetimeSeconds = 48 * 60 * 60;

export function buildPublicForumMediaUrl(config: CampuxConfig, key: string, now = Date.now()) {
  const expires = Math.floor(now / 1000) + forumMediaLifetimeSeconds;
  const signature = signForumMedia(key, expires);
  const url = new URL("/api/public/forum-media", config.webOrigin);
  url.searchParams.set("key", key);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}

export function verifyPublicForumMediaSignature(key: string, expires: number, signature: string, now = Date.now()) {
  if (!Number.isSafeInteger(expires) || expires < Math.floor(now / 1000)) {
    return false;
  }
  const expected = Buffer.from(signForumMedia(key, expires), "base64url");
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signForumMedia(key: string, expires: number) {
  return createHmac("sha256", getSigningSecret())
    .update(`${expires}\n${key}`)
    .digest("base64url");
}

function getSigningSecret() {
  const secret = process.env.CAMPUX_BOT_SESSION_SECRET
    ?? (process.env.NODE_ENV === "production" ? null : process.env.DATABASE_URL);
  if (!secret) {
    throw new Error("CAMPUX_BOT_SESSION_SECRET is required to sign QQ forum media URLs");
  }
  return secret;
}
