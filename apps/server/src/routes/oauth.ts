import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hashPassword, verifyPassword } from "@campux/db";
import { Prisma } from "@campux/db";
import { z } from "zod";
import { requireTenantContext, requireTenantRole } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { prisma } from "../lib/prisma";
import {
  appendQueryParams,
  buildOAuthErrorRedirect,
  defaultOAuthServerSettings,
  generateOAuthClientId,
  generateOAuthSecret,
  hashOAuthToken,
  isPkceMethodSupported,
  joinScopeList,
  normalizeOAuthServerSettings,
  normalizeRedirectUris,
  parseScopeList,
  verifyPkceChallenge,
  decryptState,
} from "../lib/oauth";

const oauthSettingsKey = "oauth_server";

const oauthServerSettingsSchema = z.object({
  enabled: z.boolean().default(defaultOAuthServerSettings.enabled),
  authorizationCodeTtlMinutes: z.number().int().min(1).max(1440).default(defaultOAuthServerSettings.authorizationCodeTtlMinutes),
  accessTokenTtlMinutes: z.number().int().min(5).max(10080).default(defaultOAuthServerSettings.accessTokenTtlMinutes),
  refreshTokenTtlDays: z.number().int().min(1).max(3650).default(defaultOAuthServerSettings.refreshTokenTtlDays),
  pkceRequired: z.boolean().default(defaultOAuthServerSettings.pkceRequired),
  allowPlainPkce: z.boolean().default(defaultOAuthServerSettings.allowPlainPkce),
  stateKey: z.string().min(1).max(1024).optional().nullable(),
});

const oauthClientCreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional().nullable(),
  redirectUris: z.array(z.string().url()).min(1),
  scopes: z.array(z.string().min(1).max(64)).min(1).default(["profile"]),
  enabled: z.boolean().default(true),
  pkceRequired: z.boolean().default(true),
});

const oauthClientPatchSchema = oauthClientCreateSchema.partial().extend({
  description: z.string().max(200).nullable().optional(),
});

const oauthClientParamsSchema = z.object({
  id: z.string().min(1),
});

const oauthClientInfoParamsSchema = z.object({
  clientId: z.string().min(1),
});

const oauthAuthorizeSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  scope: z.string().optional(),
  state: z.string().optional(),
  codeChallenge: z.string().min(1).optional(),
  codeChallengeMethod: z.enum(["S256", "plain"]).default("S256"),
  responseType: z.literal("code").default("code"),
  decision: z.enum(["approve", "deny"]).default("approve"),
});

const oauthTokenBodySchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  code: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  code_verifier: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  scope: z.string().optional(),
});

const oauthRevokeSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional(),
});

const oauthIntrospectionSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(["access_token", "refresh_token"]).optional(),
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional(),
});

type OAuthSettingsRecord = z.infer<typeof oauthServerSettingsSchema>;

export function registerOAuthRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/.well-known/oauth-authorization-server", async (request) => {
    const origin = `${request.protocol}://${request.headers.host ?? "localhost"}`;
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      introspection_endpoint: `${origin}/oauth/introspect`,
      userinfo_endpoint: `${origin}/oauth/userinfo`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["profile", "tenant"],
    };
  });

  app.get("/api/oauth/clients/:clientId", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const { clientId } = oauthClientInfoParamsSchema.parse(request.params);
    const client = await prisma.oAuthClient.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        clientId,
      },
    });

    if (!client) {
      return reply.code(404).send({ message: "未找到 OAuth 应用" });
    }

    const settings = await readOAuthSettings(context.selectedTenant.id);

    return {
      client: toOAuthClient(client),
      settings,
      tenant: {
        id: context.selectedTenant.id,
        name: context.selectedTenant.name,
        slug: context.selectedTenant.slug,
      },
    };
  });

  app.post("/api/oauth/authorize", async (request, reply) => {
    const context = await requireTenantContext(request, reply);
    const body = oauthAuthorizeSchema.parse(request.body);
    const settings = await readOAuthSettings(context.selectedTenant.id);
    if (!settings.enabled) {
      return reply.code(403).send({ message: "当前校园墙未启用 OAuth 服务" });
    }

    const client = await prisma.oAuthClient.findFirst({
      where: {
        tenantId: context.selectedTenant.id,
        clientId: body.clientId,
      },
    });

    if (!client || !client.enabled) {
      return reply.code(404).send({ message: "未找到 OAuth 应用" });
    }

    if (body.responseType !== "code") {
      return reply.code(400).send({ message: "仅支持 authorization_code 授权模式" });
    }

    if (!normalizeRedirectUris(client.redirectUris).includes(body.redirectUri)) {
      return reply.code(400).send({ message: "redirect_uri 未在应用中注册" });
    }

    const requestedScopes = parseScopeList(body.scope);
    const allowedScopes = Array.isArray(client.scopes) ? client.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    const effectiveScopes = requestedScopes.length > 0 ? requestedScopes : allowedScopes;
    if (effectiveScopes.length === 0) {
      return reply.code(400).send({ message: "应用未配置可用 scope" });
    }

    const invalidScope = effectiveScopes.find((scope: string) => !allowedScopes.includes(scope));
    if (invalidScope) {
      return reply.code(400).send({ message: `不支持的 scope：${invalidScope}` });
    }

    if (body.decision === "deny") {
      return {
        redirectUrl: buildOAuthErrorRedirect(body.redirectUri, {
          error: "access_denied",
          error_description: "user denied the request",
          state: body.state,
        }),
      };
    }

    if (settings.pkceRequired || client.pkceRequired) {
      if (!body.codeChallenge) {
        return reply.code(400).send({ message: "PKCE code_challenge 是必需的" });
      }
      if (!isPkceMethodSupported(body.codeChallengeMethod, settings.allowPlainPkce)) {
        return reply.code(400).send({ message: "当前只支持 S256 PKCE" });
      }
    }

    const authorizationCode = generateOAuthSecret();
    const codeHash = hashOAuthToken(authorizationCode);
    const expiresAt = new Date(Date.now() + settings.authorizationCodeTtlMinutes * 60_000);

    const originalState = body.state ?? null;
    let storedState = originalState;
    if (originalState && settings.stateKey) {
      const decrypted = decryptState(settings.stateKey, originalState);
      if (decrypted !== null) {
        storedState = decrypted;
      }
    }

    await prisma.oAuthAuthorizationCode.create({
      data: {
        tenantId: context.selectedTenant.id,
        clientId: client.id,
        userId: context.user.id,
        codeHash,
        redirectUri: body.redirectUri,
        scope: joinScopeList(effectiveScopes),
        state: storedState,
        codeChallenge: body.codeChallenge ?? null,
        codeChallengeMethod: body.codeChallengeMethod,
        expiresAt,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "oauth.authorize",
      targetType: "oauth_client",
      targetId: client.id,
      detail: {
        clientId: client.clientId,
        scope: joinScopeList(effectiveScopes),
      },
    });

    return {
      redirectUrl: appendQueryParams(body.redirectUri, {
        code: authorizationCode,
        state: originalState ?? undefined,
      }),
    };
  });

  app.post("/oauth/token", async (request, reply) => {
    const body = parseOAuthTokenRequest(request);
    const parsed = oauthTokenBodySchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "invalid token request",
      });
    }

    const tokenRequest = parsed.data;
    const { client, authError } = await authenticateOAuthClient(request, tokenRequest.client_id, tokenRequest.client_secret);
    if (authError || !client) {
      return writeInvalidClient(reply);
    }

    if (!client.enabled) {
      return writeInvalidClient(reply);
    }

    if (tokenRequest.grant_type === "authorization_code") {
      if (!tokenRequest.code || !tokenRequest.redirect_uri) {
        return reply.code(400).send({
          error: "invalid_request",
          error_description: "code and redirect_uri are required",
        });
      }

      const codeHash = hashOAuthToken(tokenRequest.code);
      const authorizationCode = await prisma.oAuthAuthorizationCode.findUnique({
        where: { codeHash },
        include: {
          tenant: true,
          client: true,
          user: true,
        },
      });

      if (!authorizationCode || authorizationCode.clientId !== client.id) {
        return writeInvalidGrant(reply, "invalid authorization code");
      }

      if (authorizationCode.consumedAt || authorizationCode.expiresAt.getTime() <= Date.now()) {
        return writeInvalidGrant(reply, "invalid authorization code");
      }

      if (authorizationCode.redirectUri !== tokenRequest.redirect_uri) {
        return writeInvalidGrant(reply, "redirect_uri mismatch");
      }

      if (authorizationCode.codeChallenge) {
        if (!tokenRequest.code_verifier) {
          return writeInvalidGrant(reply, "code_verifier is required");
        }
        const currentSettings = await readOAuthSettings(authorizationCode.tenantId);
        if (!verifyPkceChallenge(tokenRequest.code_verifier, authorizationCode.codeChallenge, authorizationCode.codeChallengeMethod, currentSettings.allowPlainPkce)) {
          return writeInvalidGrant(reply, "invalid code_verifier");
        }
      }

      await prisma.oAuthAuthorizationCode.update({
        where: { id: authorizationCode.id },
        data: { consumedAt: new Date() },
      });

      const settings = await readOAuthSettings(authorizationCode.tenantId);
      const tokens = await issueOAuthTokenPair({
        tenantId: authorizationCode.tenantId,
        clientId: client.id,
        userId: authorizationCode.userId,
        scope: authorizationCode.scope,
        settings,
      });

      return {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: settings.accessTokenTtlMinutes * 60,
        refresh_token: tokens.refreshToken,
        scope: authorizationCode.scope,
      };
    }

    if (!tokenRequest.refresh_token) {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "refresh_token is required",
      });
    }

    const refreshTokenHash = hashOAuthToken(tokenRequest.refresh_token);
    const tokenRecord = await prisma.oAuthAccessToken.findUnique({
      where: {
        refreshTokenHash,
      },
      include: {
        tenant: true,
        client: true,
        user: true,
      },
    });

    if (!tokenRecord || tokenRecord.clientId !== client.id || tokenRecord.revokedAt || !tokenRecord.refreshExpiresAt || tokenRecord.refreshExpiresAt.getTime() <= Date.now()) {
      return writeInvalidGrant(reply, "invalid refresh token");
    }

    await prisma.oAuthAccessToken.update({
      where: { id: tokenRecord.id },
      data: {
        revokedAt: new Date(),
      },
    });

    const settings = await readOAuthSettings(tokenRecord.tenantId);
    const tokens = await issueOAuthTokenPair({
      tenantId: tokenRecord.tenantId,
      clientId: client.id,
      userId: tokenRecord.userId,
      scope: tokenRecord.scope,
      settings,
    });

    return {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: settings.accessTokenTtlMinutes * 60,
      refresh_token: tokens.refreshToken,
      scope: tokenRecord.scope,
    };
  });

  app.get("/oauth/userinfo", async (request, reply) => {
    const tokenRecord = await requireOAuthAccessToken(request, reply);
    if (!tokenRecord) {
      return;
    }

    await prisma.oAuthAccessToken.update({
      where: { id: tokenRecord.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      sub: tokenRecord.user.id,
      name: tokenRecord.user.displayName ?? tokenRecord.user.qqUin.toString(),
      preferred_username: tokenRecord.user.displayName ?? tokenRecord.user.qqUin.toString(),
      tenant_id: tokenRecord.tenant.id,
      tenant_name: tokenRecord.tenant.name,
      tenant_slug: tokenRecord.tenant.slug,
      scope: tokenRecord.scope,
      client_id: tokenRecord.client.clientId,
    };
  });

  app.post("/oauth/introspect", async (request, reply) => {
    const body = oauthIntrospectionSchema.safeParse(parseOAuthFormBody(request));
    if (!body.success) {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "invalid introspection request",
      });
    }

    const { client } = await authenticateOAuthClient(request, body.data.client_id, body.data.client_secret);
    if (!client) {
      return writeInvalidClient(reply);
    }

    const token = await findOAuthAccessToken(body.data.token);
    if (!token) {
      return { active: false };
    }

    return {
      active: !token.revokedAt && token.expiresAt.getTime() > Date.now(),
      client_id: token.client.clientId,
      username: token.user.displayName ?? token.user.qqUin.toString(),
      sub: token.user.id,
      scope: token.scope,
      exp: Math.floor(token.expiresAt.getTime() / 1000),
      iat: Math.floor(token.createdAt.getTime() / 1000),
      token_type: "access_token",
      tenant_id: token.tenant.id,
    };
  });

  app.post("/oauth/revoke", async (request, reply) => {
    const body = oauthRevokeSchema.safeParse(parseOAuthFormBody(request));
    if (!body.success) {
      return reply.code(400).send({
        error: "invalid_request",
        error_description: "invalid revocation request",
      });
    }

    const { client } = await authenticateOAuthClient(request, body.data.client_id, body.data.client_secret);
    if (!client) {
      return writeInvalidClient(reply);
    }

    const token = await findOAuthAccessToken(body.data.token);
    if (!token || token.clientId !== client.id) {
      return { ok: true };
    }

    await prisma.oAuthAccessToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  });

  app.get("/api/admin/oauth/settings", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    return {
      settings: await readOAuthSettings(context.selectedTenant.id),
    };
  });

  app.patch("/api/admin/oauth/settings", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = oauthServerSettingsSchema.parse(request.body);

    await prisma.tenantMetadata.upsert({
      where: {
        tenantId_key: {
          tenantId: context.selectedTenant.id,
          key: oauthSettingsKey,
        },
      },
      update: {
        value: body,
      },
      create: {
        tenantId: context.selectedTenant.id,
        key: oauthSettingsKey,
        value: body,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "oauth.settings.update",
      targetType: "tenant",
      targetId: context.selectedTenant.id,
      detail: body,
    });

    return { settings: normalizeOAuthServerSettings(body) };
  });

  app.get("/api/admin/oauth/clients", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const clients = await prisma.oAuthClient.findMany({
      where: {
        tenantId: context.selectedTenant.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return {
      clients: clients.map(toOAuthClient),
    };
  });

  app.post("/api/admin/oauth/clients", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const body = oauthClientCreateSchema.parse(request.body);
    const clientSecret = generateOAuthSecret();

    const client = await prisma.oAuthClient.create({
      data: {
        tenantId: context.selectedTenant.id,
        clientId: generateOAuthClientId(),
        clientSecretHash: await hashPassword(clientSecret),
        name: body.name,
        description: body.description ?? null,
        redirectUris: normalizeRedirectUris(body.redirectUris),
        scopes: Array.from(new Set(body.scopes.map((scope) => scope.trim()).filter(Boolean))),
        enabled: body.enabled,
        pkceRequired: body.pkceRequired,
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "oauth.client.create",
      targetType: "oauth_client",
      targetId: client.id,
      detail: {
        clientId: client.clientId,
        name: client.name,
      },
    });

    return {
      client: toOAuthClient(client),
      clientSecret,
    };
  });

  app.patch("/api/admin/oauth/clients/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const { id } = oauthClientParamsSchema.parse(request.params);
    const body = oauthClientPatchSchema.parse(request.body);

    const client = await prisma.oAuthClient.findFirst({
      where: {
        id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!client) {
      return reply.code(404).send({ message: "未找到 OAuth 应用" });
    }

    const updated = await prisma.oAuthClient.update({
      where: { id: client.id },
      data: {
        name: body.name ?? client.name,
        description: body.description === undefined ? client.description : body.description,
        enabled: body.enabled ?? client.enabled,
        pkceRequired: body.pkceRequired ?? client.pkceRequired,
        ...(body.redirectUris !== undefined ? { redirectUris: normalizeRedirectUris(body.redirectUris) } : {}),
        ...(body.scopes !== undefined
          ? { scopes: Array.from(new Set(body.scopes.map((scope) => scope.trim()).filter(Boolean))) }
          : {}),
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "oauth.client.update",
      targetType: "oauth_client",
      targetId: updated.id,
      detail: {
        clientId: updated.clientId,
      },
    });

    return {
      client: toOAuthClient(updated),
    };
  });

  app.post("/api/admin/oauth/clients/:id/secret", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const { id } = oauthClientParamsSchema.parse(request.params);
    const client = await prisma.oAuthClient.findFirst({
      where: {
        id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!client) {
      return reply.code(404).send({ message: "未找到 OAuth 应用" });
    }

    const clientSecret = generateOAuthSecret();
    const updated = await prisma.oAuthClient.update({
      where: { id: client.id },
      data: {
        clientSecretHash: await hashPassword(clientSecret),
      },
    });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "oauth.client.secret.rotate",
      targetType: "oauth_client",
      targetId: updated.id,
      detail: {
        clientId: updated.clientId,
      },
    });

    return {
      client: toOAuthClient(updated),
      clientSecret,
    };
  });

  app.delete("/api/admin/oauth/clients/:id", async (request, reply) => {
    const context = await requireTenantRole(request, reply, "admin");
    const { id } = oauthClientParamsSchema.parse(request.params);
    const client = await prisma.oAuthClient.findFirst({
      where: {
        id,
        tenantId: context.selectedTenant.id,
      },
    });

    if (!client) {
      return reply.code(404).send({ message: "未找到 OAuth 应用" });
    }

    await prisma.oAuthClient.delete({ where: { id: client.id } });

    await writeAuditLog({
      tenantId: context.selectedTenant.id,
      actorId: context.user.id,
      action: "oauth.client.delete",
      targetType: "oauth_client",
      targetId: client.id,
      detail: {
        clientId: client.clientId,
      },
    });

    return { ok: true };
  });
}

function toOAuthClient(client: {
  id: string;
  tenantId: string;
  clientId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  pkceRequired: boolean;
  redirectUris: Prisma.JsonValue;
  scopes: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: client.id,
    tenantId: client.tenantId,
    clientId: client.clientId,
    name: client.name,
    description: client.description,
    enabled: client.enabled,
    pkceRequired: client.pkceRequired,
    redirectUris: normalizeRedirectUris(client.redirectUris),
    scopes: Array.isArray(client.scopes) ? client.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

async function readOAuthSettings(tenantId: string) {
  const record = await prisma.tenantMetadata.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: oauthSettingsKey,
      },
    },
  });

  return normalizeOAuthServerSettings(record?.value);
}

async function issueOAuthTokenPair({
  tenantId,
  clientId,
  userId,
  scope,
  settings,
}: {
  tenantId: string;
  clientId: string;
  userId: string;
  scope: string;
  settings: OAuthSettingsRecord;
}) {
  const accessToken = generateOAuthSecret();
  const refreshToken = generateOAuthSecret();
  await prisma.oAuthAccessToken.create({
    data: {
      tenantId,
      clientId,
      userId,
      tokenHash: hashOAuthToken(accessToken),
      refreshTokenHash: hashOAuthToken(refreshToken),
      scope,
      expiresAt: new Date(Date.now() + settings.accessTokenTtlMinutes * 60_000),
      refreshExpiresAt: new Date(Date.now() + settings.refreshTokenTtlDays * 24 * 60 * 60_000),
    },
  });

  return { accessToken, refreshToken };
}

async function requireOAuthAccessToken(request: FastifyRequest, reply: FastifyReply) {
  const token = getBearerToken(request);
  if (!token) {
    reply.header("WWW-Authenticate", 'Bearer realm="oauth2", error="invalid_token"');
    reply.code(401).send({ error: "invalid_token" });
    return null;
  }

  const tokenRecord = await findOAuthAccessToken(token);
  if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.expiresAt.getTime() <= Date.now()) {
    reply.header("WWW-Authenticate", 'Bearer realm="oauth2", error="invalid_token"');
    reply.code(401).send({ error: "invalid_token" });
    return null;
  }

  return tokenRecord;
}

async function findOAuthAccessToken(token: string) {
  return prisma.oAuthAccessToken.findUnique({
    where: {
      tokenHash: hashOAuthToken(token),
    },
    include: {
      tenant: true,
      client: true,
      user: true,
    },
  });
}

function parseOAuthTokenRequest(request: FastifyRequest) {
  if (typeof request.body === "string") {
    return Object.fromEntries(new URLSearchParams(request.body));
  }

  if (request.body && typeof request.body === "object") {
    return request.body as Record<string, unknown>;
  }

  return {};
}

function parseOAuthFormBody(request: FastifyRequest) {
  return parseOAuthTokenRequest(request);
}

function getBearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

async function authenticateOAuthClient(request: FastifyRequest, clientId?: string, clientSecret?: string) {
  const basicCredentials = parseBasicAuth(request.headers.authorization);
  if (basicCredentials) {
    clientId = basicCredentials.clientId;
    clientSecret = basicCredentials.clientSecret;
  }

  if (!clientId) {
    return { client: null, authError: true };
  }

  const client = await prisma.oAuthClient.findUnique({
    where: {
      clientId,
    },
  });

  if (!client) {
    return { client: null, authError: true };
  }

  if (client.clientSecretHash) {
    if (!clientSecret) {
      return { client: null, authError: true };
    }

    if (!(await verifyPassword(clientSecret, client.clientSecretHash))) {
      return { client: null, authError: true };
    }
  }

  return { client, authError: false };
}

function parseBasicAuth(authorization?: string) {
  if (!authorization) {
    return null;
  }

  const [scheme, encoded] = authorization.split(/\s+/, 2);
  if (!scheme || !encoded || scheme.toLowerCase() !== "basic") {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  const clientId = decoded.slice(0, separatorIndex);
  const clientSecret = decoded.slice(separatorIndex + 1);
  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

function writeInvalidClient(reply: FastifyReply) {
  reply.header("WWW-Authenticate", 'Basic realm="oauth2", error="invalid_client"');
  return reply.code(401).send({
    error: "invalid_client",
    error_description: "invalid client authentication",
  });
}

function writeInvalidGrant(reply: FastifyReply, description: string) {
  return reply.code(400).send({
    error: "invalid_grant",
    error_description: description,
  });
}