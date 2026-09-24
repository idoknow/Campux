import type { FastifyInstance } from "fastify";
import type { CampuxConfig } from "@campux/config";

/**
 * 关于页公开信息：产品名、当前构建版本、部署形态与官方最新版本。
 *
 * 部署形态按请求域名判定：Campux 官方实例只在 campux.top 及其子域上提供服务，
 * 其它域名（自托管域名、localhost）一律算私有部署。
 *
 * 「官方最新版本」取自 GitHub Releases；自托管实例可能访问不到 GitHub，
 * 取不到时返回 null，由页面降级展示，不影响其余信息。
 */

const latestReleaseApiUrl = "https://api.github.com/repos/idoknow/Campux/releases/latest";
const officialCloudDomain = "campux.top";
const latestVersionSuccessTtlMs = 30 * 60 * 1000;
const latestVersionFailureTtlMs = 5 * 60 * 1000;
const latestVersionTimeoutMs = 4_000;

type LatestVersionCache = { value: string | null; expiresAt: number };

function isOfficialCloudHost(host: string | undefined) {
  const hostname = host?.split(":")[0]?.trim().toLowerCase();
  if (!hostname) {
    return false;
  }
  return hostname === officialCloudDomain || hostname.endsWith(`.${officialCloudDomain}`);
}

export function registerAboutRoutes(app: FastifyInstance, config: CampuxConfig) {
  let latestVersionCache: LatestVersionCache | null = null;

  async function readLatestVersion(): Promise<string | null> {
    if (latestVersionCache && latestVersionCache.expiresAt > Date.now()) {
      return latestVersionCache.value;
    }

    try {
      const response = await fetch(latestReleaseApiUrl, {
        headers: {
          // GitHub API 会拒绝缺少 User-Agent 的请求。
          "User-Agent": `Campux/${config.buildVersion}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(latestVersionTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`GitHub releases responded ${response.status}`);
      }
      const payload = (await response.json()) as { tag_name?: unknown };
      const tag = typeof payload.tag_name === "string" && payload.tag_name.trim() ? payload.tag_name.trim() : null;
      latestVersionCache = { value: tag, expiresAt: Date.now() + latestVersionSuccessTtlMs };
      return tag;
    } catch (caught) {
      // 失败结果也缓存，避免网络受限的实例每次打开关于页都卡在超时上。
      app.log.warn({ err: caught }, "failed to read latest Campux release");
      latestVersionCache = { value: null, expiresAt: Date.now() + latestVersionFailureTtlMs };
      return null;
    }
  }

  app.get("/api/about", async (request) => ({
    product: "Campux",
    version: config.buildVersion,
    deployment: isOfficialCloudHost(request.headers.host) ? ("cloud" as const) : ("self-hosted" as const),
    latestVersion: await readLatestVersion(),
  }));
}
