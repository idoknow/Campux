/**
 * 凑批发布（accumulate 模式）的纯判定逻辑。
 *
 * 计数口径：一条稿件的图片数 = 1 张渲染卡片图 + attachments（投稿原图）数量。
 * 一个批次的图片总数 = 批次内所有稿件图片数之和。一条说说上传的图片就是
 * [卡片#1, 原图#1.., 卡片#2, 原图#2.., ...]，与此口径一致。
 *
 * 这里只做"加入一条新稿件时该怎么办"的决策，不触碰数据库 —— 便于单测。
 */

import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma";
import { readTenantPublishMode } from "../lib/tenant-metadata";
import { enqueueBatchPublishFanout } from "./publishing";
import type { RuntimeQueue } from "./queue";

export const RENDERED_CARD_IMAGE_COUNT = 1;

export const BATCH_CAPTION_SEPARATOR = "\n———\n";

/**
 * 把批次内每条稿件已渲染好的配文，用分隔行合并成一条说说的正文。
 * 入参是各条稿件的 caption（已按 position 升序）。
 */
export function joinBatchCaptions(captions: string[]): string {
  const nonEmpty = captions.map((caption) => caption.trim()).filter(Boolean);
  if (nonEmpty.length === 0) {
    return "";
  }
  return nonEmpty.join(BATCH_CAPTION_SEPARATOR);
}

/**
 * 计算一条稿件占用的图片数：1 张渲染卡片 + 投稿原图数量。
 */
export function postImageCount(attachments: unknown): number {
  const attachmentCount = Array.isArray(attachments) ? attachments.length : 0;
  return RENDERED_CARD_IMAGE_COUNT + attachmentCount;
}

export type FlushDecision =
  // 还没凑够下限，继续等下一条稿件。新稿件加入当前批次。
  | { action: "wait" }
  // 加入这条后正好落在 [min, max]，立即发整个批次（含这条）。
  | { action: "flush" }
  // 加入这条会超过上限，但"加入前"的批次已达下限：
  // 先把"不含这条"的当前批次发掉，再用这条另起一个新批次（新批次可能自己再触发判定）。
  | { action: "flush_then_start_new" }
  // 单条稿件自身图片数就 >= min（甚至 > max），且当前批次为空（prevTotal=0）：
  // 这条无法再拆，单独成批立即发（允许超过 max），并告警。
  | { action: "flush_single_oversize" };

/**
 * @param prevTotal 加入这条稿件之前，当前 collecting 批次已累计的图片数（空批次为 0）
 * @param postImages 这条稿件的图片数（>= 1）
 * @param min 下限（>= 1）
 * @param max 上限（>= min）
 */
export function decideFlush(prevTotal: number, postImages: number, min: number, max: number): FlushDecision {
  const total = prevTotal + postImages;

  // 单条稿件自身就顶满/超过上限，且当前批次为空 —— 无法再与别人拼，也无法拆，单独成批发。
  if (prevTotal === 0 && postImages >= min) {
    // 自身 <= max：正常单独成批（落区间）；自身 > max：超界单独成批并告警。
    return postImages > max ? { action: "flush_single_oversize" } : { action: "flush" };
  }

  if (total < min) {
    // 还不够，继续攒。
    return { action: "wait" };
  }

  if (total <= max) {
    // 正好落区间，发掉（含这条）。
    return { action: "flush" };
  }

  // total > max：这条把批次顶过了上限。
  // 因为上面已处理 prevTotal===0 的情况，这里 prevTotal > 0。
  if (prevTotal >= min) {
    // 旧批次（不含这条）已达下限 —— 先发旧批，这条另起新批。
    return { action: "flush_then_start_new" };
  }

  // 旧批次还没到下限，但加上这条就超过了上限：
  // 说明这条稿件较大。为不让旧批的稿件继续干等，连同这条一起发（接受略超 max）。
  // 这是边界取舍：宁可一条说说图片略多，也不把已有稿件无限期搁置。
  return { action: "flush" };
}

// ── 以下是有状态部分：操作数据库、调度发布 ──────────────────────────────

/** 每租户的凑批操作用 advisory lock 串行化，避免并发审核把同一条稿件塞进两个批次。 */
async function lockTenantBatch<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campux:batch:${tenantId}`})::bigint)`;
    return fn();
  });
}

async function getOrCreateCollectingBatch(tenantId: string) {
  const existing = await prisma.publishBatch.findFirst({
    where: { tenantId, status: "collecting" },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing;
  }
  return prisma.publishBatch.create({
    data: { tenantId, status: "collecting", imageCount: 0 },
  });
}

async function appendItemToBatch(batchId: string, postId: string, postImages: number) {
  const count = await prisma.publishBatchItem.count({ where: { batchId } });
  await prisma.publishBatchItem.create({
    data: { batchId, postId, position: count, imageCount: postImages },
  });
  await prisma.publishBatch.update({
    where: { id: batchId },
    data: {
      imageCount: { increment: postImages },
      lastItemAt: new Date(),
    },
  });
}

/**
 * accumulate 模式：一条稿件审核通过后调用。把它放入当前 collecting 批次，
 * 按 decideFlush 决定是否触发发布。post 先置 publishing 表示"已入凑批队列"。
 */
export async function addApprovedPostToBatch(
  queue: RuntimeQueue,
  tenantId: string,
  postId: string,
  actorId: string | null,
  logger?: FastifyBaseLogger,
): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, status: true, attachments: true, batchItem: { select: { id: true } } },
  });
  if (!post || post.batchItem) {
    // 已在某个批次里，幂等返回。
    return;
  }

  const { minImages, maxImages } = await readTenantPublishMode(prisma, tenantId);
  const postImages = postImageCount(post.attachments);

  // 把 post 标记为"已进入凑批队列"（复用 publishing 态，避免新增 PostStatus）。
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: "publishing",
      logs: {
        create: {
          tenantId,
          actorId,
          oldStatus: post.status,
          newStatus: "publishing",
          comment: "已进入凑批发布队列，等待与其他稿件合并为一条说说发布",
        },
      },
    },
  });

  // 在锁内决定归批 / flush。
  const toFlush: string[] = [];
  await lockTenantBatch(tenantId, async () => {
    let batch = await getOrCreateCollectingBatch(tenantId);
    const decision = decideFlush(batch.imageCount, postImages, minImages, maxImages);

    switch (decision.action) {
      case "wait": {
        await appendItemToBatch(batch.id, postId, postImages);
        break;
      }
      case "flush": {
        await appendItemToBatch(batch.id, postId, postImages);
        await prisma.publishBatch.update({ where: { id: batch.id }, data: { status: "publishing" } });
        toFlush.push(batch.id);
        break;
      }
      case "flush_then_start_new": {
        // 先发掉不含这条的旧批，再用这条另起新批。
        await prisma.publishBatch.update({ where: { id: batch.id }, data: { status: "publishing" } });
        toFlush.push(batch.id);
        const fresh = await prisma.publishBatch.create({ data: { tenantId, status: "collecting", imageCount: 0 } });
        await appendItemToBatch(fresh.id, postId, postImages);
        // 这条单独成新批后，判断它自己是否也需要立刻 flush。
        const selfDecision = decideFlush(0, postImages, minImages, maxImages);
        if (selfDecision.action === "flush" || selfDecision.action === "flush_single_oversize") {
          await prisma.publishBatch.update({ where: { id: fresh.id }, data: { status: "publishing" } });
          toFlush.push(fresh.id);
        }
        break;
      }
      case "flush_single_oversize": {
        // 单条稿件图片数已超上限，单独成批发出，告警。
        await appendItemToBatch(batch.id, postId, postImages);
        await prisma.publishBatch.update({ where: { id: batch.id }, data: { status: "publishing" } });
        toFlush.push(batch.id);
        logger?.warn(
          { tenantId, postId, postImages, maxImages },
          "single post image count exceeds accumulate max; publishing it as its own oversize batch",
        );
        break;
      }
    }
  });

  for (const batchId of toFlush) {
    await enqueueBatchPublishFanout(queue, tenantId, batchId, actorId);
  }
}

let sweeperTimer: ReturnType<typeof setInterval> | undefined;

/**
 * 兜底定时器：周期扫描"停滞过久"的 collecting 批次（已达下限但长时间无新增），
 * 直接 flush，避免低投稿量墙号的稿件一直攒着不发。停滞阈值是租户可调设置。
 */
export function registerBatchFlushSweeper(queue: RuntimeQueue, logger: FastifyBaseLogger) {
  const intervalMs = 5 * 60 * 1000; // 每 5 分钟扫一次
  const run = async () => {
    try {
      const batches = await prisma.publishBatch.findMany({
        where: { status: "collecting" },
        select: { id: true, tenantId: true, imageCount: true, lastItemAt: true },
      });
      const now = Date.now();
      for (const batch of batches) {
        if (batch.imageCount <= 0 || !batch.lastItemAt) {
          continue;
        }
        const { mode, minImages, staleMinutes } = await readTenantPublishMode(prisma, batch.tenantId);
        if (mode !== "accumulate") {
          continue;
        }
        if (batch.imageCount < minImages) {
          continue;
        }
        if (now - batch.lastItemAt.getTime() < staleMinutes * 60 * 1000) {
          continue;
        }
        // 在锁内确认仍是 collecting 再切 publishing，避免与并发审核竞争。
        let shouldFlush = false;
        await lockTenantBatch(batch.tenantId, async () => {
          const fresh = await prisma.publishBatch.findUnique({ where: { id: batch.id }, select: { status: true } });
          if (fresh?.status === "collecting") {
            await prisma.publishBatch.update({ where: { id: batch.id }, data: { status: "publishing" } });
            shouldFlush = true;
          }
        });
        if (shouldFlush) {
          logger.info({ batchId: batch.id, tenantId: batch.tenantId, imageCount: batch.imageCount }, "stale accumulate batch flushed by sweeper");
          await enqueueBatchPublishFanout(queue, batch.tenantId, batch.id, null);
        }
      }
    } catch (error) {
      logger.error({ error }, "batch flush sweeper run failed");
    }
  };
  sweeperTimer = setInterval(() => void run(), intervalMs);
  logger.info("batch flush sweeper registered");
}

export function stopBatchFlushSweeper() {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = undefined;
  }
}

