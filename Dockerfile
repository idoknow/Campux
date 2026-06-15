# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.12

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json bun.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
# 注：自定义字体（「字体选择」雕花功能）默认不随仓库分发，避免数十 MB TTF 进 git 历史。
# packages/render 在 <项目根>/font 缺失时会自动回退到下方 apk 安装的 noto-cjk 系统字体。
# 自托管者若需启用该功能，可自行在此 COPY 字体目录。

RUN bun install --frozen-lockfile
RUN bun run db:generate
RUN bun run build

FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ca-certificates chromium font-noto-cjk font-noto-emoji openssl tzdata

# Release identifier baked in by CI (branch-shortsha); surfaces in /api/health
# style diagnostics and the anonymous telemetry version distribution.
ARG CAMPUX_BUILD_VERSION=dev
ENV CAMPUX_BUILD_VERSION=${CAMPUX_BUILD_VERSION}

ENV NODE_ENV=production
# Campux only operates in China; pin the whole process to Beijing time so every
# Date method (daily/hourly stats buckets, schedulers) resolves in UTC+8.
ENV TZ=Asia/Shanghai
ENV CAMPUX_SERVER_HOST=0.0.0.0
ENV CAMPUX_SERVER_PORT=8989
ENV CAMPUX_WEB_DIST_DIR=/app/apps/web/dist
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=build /app /app

EXPOSE 8989

CMD ["bun", "--cwd", "apps/server", "src/index.ts"]
