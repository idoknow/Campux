/**
 * Regression test: 改密（管理员重置 / 自助改密 / 找回密码）后，之前签发的登录会话必须失效。
 *
 * 会话签发时会记下当时的 User.tokenVersion；改密会把它 +1，两边对不上即视为失效。
 * 这同时堵住「改密前用旧密码登录、改密后才建会话」的竞态。
 *
 * 本套件是 opt-in（需要一次性的 DATABASE_URL）：
 *   CAMPUX_E2E_DB=1 bun test apps/server/src/routes/auth-session-version.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { hashPassword } from "@campux/db";
import { prisma } from "../lib/prisma";
import { bumpTokenVersion, createSession, getSessionContext, sessionCookieName } from "../lib/auth";

const runE2E = process.env.CAMPUX_E2E_DB === "1";
const maybeDescribe = runE2E ? describe : describe.skip;

maybeDescribe("password version invalidates old sessions", () => {
  let userId = "";
  let token = "";

  beforeAll(async () => {
    if (!runE2E) return;
    userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, qqUin: BigInt(Date.now()), passwordHash: await hashPassword("oldpass123") },
    });
    token = await createSession(userId, null);
  });

  function requestWithSession() {
    return {
      headers: { cookie: `${sessionCookieName}=${encodeURIComponent(token)}`, host: "127.0.0.1" },
    } as unknown as FastifyRequest;
  }

  test("session is valid before the password changes", async () => {
    if (!runE2E) return;
    const context = await getSessionContext(requestWithSession());
    expect(context?.user.id).toBe(userId);
  });

  test("bumping the password version invalidates the session", async () => {
    if (!runE2E) return;
    await bumpTokenVersion(prisma, userId);
    const context = await getSessionContext(requestWithSession());
    expect(context).toBeNull();
  });

  afterAll(async () => {
    if (!runE2E) return;
    await prisma.accountSession.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
});
