import { newWithBuffer, loadContentFromFile, defaultDbFile, isValidIp } from "ip2region-ts";

// Offline IP -> Chinese province resolution.
//
// Campux is a China-only product, so the useful geo cut is the mainland
// province. We resolve it from the instance's reporting IP (request.ip, which
// Fastify resolves from CF-Connecting-IP / X-Forwarded-For because trustProxy
// is on) using the bundled ip2region xdb. This is fully offline — no per-report
// network call and no dependency on a CDN managed transform being enabled.
//
// ip2region returns "国家|区域|省份|城市|ISP", e.g. "中国|0|广东省|深圳市|电信".
// We keep field index 2 (province) and only for mainland China rows; anything
// else (overseas, intranet, unknown) resolves to null so it is not counted in
// the province distribution.

let searcher: ReturnType<typeof newWithBuffer> | null = null;
let loadFailed = false;

function getSearcher(): ReturnType<typeof newWithBuffer> | null {
  if (searcher) return searcher;
  if (loadFailed) return null;
  try {
    // Load the whole xdb into memory once (~11 MB). Pure in-memory lookups after
    // this, no file descriptors held open per request.
    searcher = newWithBuffer(loadContentFromFile(defaultDbFile));
    return searcher;
  } catch {
    // If the data file is somehow missing in a build, degrade gracefully: geo
    // is best-effort metadata, never a hard ingest dependency.
    loadFailed = true;
    return null;
  }
}

// ip2region city/province cells that are not real mainland provinces.
const NON_PROVINCE = new Set(["0", "", "内网IP", "未分配或者内网IP"]);

/**
 * Resolve an IP to a mainland-China province name (e.g. "广东省"), or null when
 * the IP is invalid, private, overseas, or cannot be located. Best-effort: any
 * failure resolves to null rather than throwing, because geo is optional
 * metadata and must never block telemetry ingestion.
 */
export async function lookupProvince(ip: string | undefined | null): Promise<string | null> {
  if (!ip || !isValidIp(ip)) return null;
  const s = getSearcher();
  if (!s) return null;
  try {
    const { region } = await s.search(ip);
    if (!region) return null;
    const parts = region.split("|");
    if ((parts[0] ?? "") !== "中国") return null; // overseas / intranet / unknown
    const province = parts[2] ?? "";
    if (NON_PROVINCE.has(province)) return null;
    return province;
  } catch {
    return null;
  }
}
