import { prisma } from "../lib/prisma";

/**
 * Campaign end-time scheduler. Every interval, any running campaign whose
 * endsAt is in the past is transitioned to `ended`. Idempotent: the WHERE
 * clause matches only rows still in `running` with a past endsAt.
 */
const CLOSE_INTERVAL_MS = 60 * 1000;

export function startCampaignScheduler() {
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    try {
      const result = await prisma.campaign.updateMany({
        where: { status: "running", endsAt: { lte: new Date() } },
        data: { status: "ended" },
      });
      if (result.count > 0) {
        console.log(`[campaigns] auto-ended ${result.count} expired campaign(s)`);
      }
    } catch (error) {
      console.error("[campaigns] auto-end tick failed", error);
    }
  }

  timer = setInterval(() => void tick(), CLOSE_INTERVAL_MS);
  // Fire once shortly after boot so a restart doesn't leave stale rows.
  setTimeout(() => void tick(), 10 * 1000);

  return () => {
    if (timer) clearInterval(timer);
  };
}
