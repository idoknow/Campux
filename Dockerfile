# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.12

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json bun.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run db:generate
RUN bun run build

FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ca-certificates chromium font-noto-cjk openssl

ENV NODE_ENV=production
ENV CAMPUX_SERVER_HOST=0.0.0.0
ENV CAMPUX_SERVER_PORT=8989
ENV CAMPUX_WEB_DIST_DIR=/app/apps/web/dist
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=build /app /app

EXPOSE 8989

CMD ["sh", "-c", "bun --cwd packages/db prisma migrate deploy && exec bun --cwd apps/server src/index.ts"]
