# syntax=docker/dockerfile:1.7
# Central telemetry collector + dashboard (dash.campux.top).
# Build from the repo root so workspace packages resolve:
#   docker build -f apps/dash/Dockerfile -t rockchin/campux-dash .

ARG BUN_VERSION=1.3.12

FROM oven/bun:${BUN_VERSION}-alpine
WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

ENV NODE_ENV=production
# Same convention as the main server: fleet stats bucket days in Beijing time.
ENV TZ=Asia/Shanghai
ENV CAMPUX_DASH_HOST=0.0.0.0
ENV CAMPUX_DASH_PORT=8990
ENV CAMPUX_DASH_DB_PATH=/data/campux-dash.sqlite

COPY package.json bun.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun --cwd apps/dash typecheck

EXPOSE 8990
VOLUME /data

CMD ["bun", "--cwd", "apps/dash", "src/index.ts"]
