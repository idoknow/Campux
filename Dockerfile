# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.12

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

RUN apk add --no-cache git openssl

COPY package.json bun.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN git clone --depth=1 https://github.com/idoknow/Campux-ttf.git /tmp/Campux-ttf \
	&& mkdir -p /app/font \
	&& cp /tmp/Campux-ttf/BeiShiDaJiaGuWenZiTi-1.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/chengmingshouxieti.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/hanchanhuokaiti.otf /app/font/ \
	&& cp /tmp/Campux-ttf/lipinhuiziyouluoti.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/yishanbeizhuanti.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/cascadianextjianti.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/hanchanbanyuanti.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/hongmengsansscmediumziti.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/linhailishu.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/namidiansong.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/siyuanyuanti.ttf /app/font/ \
	&& cp /tmp/Campux-ttf/zhouzisongti.otf /app/font/

RUN bun install --frozen-lockfile
RUN bun run db:generate
RUN bun run build

FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ca-certificates chromium ffmpeg font-noto-cjk font-noto-emoji openssl tzdata

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
ENV CAMPUX_FONT_DIR=/app/font
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=build /app /app

EXPOSE 8989

CMD ["bun", "--cwd", "apps/server", "src/index.ts"]
