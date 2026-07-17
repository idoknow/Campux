export function getServerSigningSecret(): string {
  const secret = process.env.CAMPUX_BOT_SESSION_SECRET
    ?? (process.env.NODE_ENV === "production" ? null : process.env.DATABASE_URL);
  if (!secret) {
    throw new Error("CAMPUX_BOT_SESSION_SECRET is required for server-signed claims");
  }
  return secret;
}
