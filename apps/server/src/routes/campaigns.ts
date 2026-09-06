import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@campux/db";
import type { CampuxConfig } from "@campux/config";
import { prisma } from "../lib/prisma";
import { requireReadyTenant } from "../lib/auth";
import { runWithActiveTenantLease } from "../lib/tenant-runtime-lease";
import { writeAuditLog } from "../lib/audit";
import {
  compressImageBuffer,
  deleteAttachmentObjects,
  uploadAttachmentBytes,
} from "../lib/attachments";
import {
  resolveImageUploadLimits,
  buildImageSourceSizeErrorMessage,
  validateProcessedImageSize,
} from "../lib/image-upload-policy";
import { readTenantImageCompression } from "../lib/tenant-metadata";
import { readTenantPluginConfig } from "../lib/tenant-plugin-config";
import type { OneBotRuntime } from "../runtime/onebot";

const MIN_DURATION_HOURS = 12;
const MAX_DURATION_HOURS = 365 * 24;
const MAX_TITLE_LENGTH = 60;
const MAX_OPTIONS = 20;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type CampaignAttachment = { key: string; url: string; fileName: string; contentType: string; size: number };

const createBodySchema = z.object({
  title: z.string().trim().min(2).max(MAX_TITLE_LENGTH),
  cover: z.string().max(8 * 1024 * 1024).nullish(),
  anonymous: z.boolean().optional(),
  votesPerPerson: z.number().int().min(1).max(20).default(1),
  allowStackOnOption: z.boolean().default(false),
  durationHours: z.number().int().min(MIN_DURATION_HOURS).max(MAX_DURATION_HOURS),
  showVoterDetails: z.boolean().default(true),
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(40), image: z.string().max(8 * 1024 * 1024).nullish() }))
    .min(2)
    .max(MAX_OPTIONS),
});

const paramsSchema = z.object({ id: z.string().min(1) });

const listQuerySchema = z.object({
  filter: z.enum(["active", "ending_soon", "ended", "pending"]).default("active"),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const voteBodySchema = z.object({
  optionId: z.string().min(1),
  count: z.number().int().min(1).max(50),
});

const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(300),
});

function toAttachmentJson(attachment: CampaignAttachment | null): Prisma.InputJsonValue {
  // Prisma 的 JsonNullValueInput 是 { value: null }，直接回 null 会被识别为「未设值」。
  if (!attachment) return { value: null };
  return {
    key: attachment.key,
    url: attachment.url,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
  } as Prisma.InputJsonValue;
}

function buildListWhere(tenantId: string, filter: string, keyword: string | undefined) {
  const now = new Date();
  const soon = new Date(Date.now() + 6 * 3600_000);
  const base: Record<string, unknown> = { tenantId };
  switch (filter) {
    case "pending":
      base.status = "pending_approval";
      break;
    case "ending_soon":
      base.status = "running";
      base.endsAt = { gte: now, lte: soon };
      break;
    case "ended":
      base.status = "ended";
      break;
    default:
      base.status = "running";
      base.endsAt = { gt: now };
      break;
  }
  if (keyword?.trim()) {
    const query = keyword.trim();
    const orClauses: Array<Record<string, unknown>> = [{ title: { contains: query } }];
    if (/^\d+$/.test(query)) orClauses.push({ displayId: Number(query) });
    base.OR = orClauses;
  }
  return base;
}

// 前端将图片读成 data URL 后随表单一起提交，服务端解码、压缩后落存储。
async function uploadImageDataUrl(config: CampuxConfig, tenantId: string, dataUrl: string, fileName: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  const [, rawContentType, rawPayload] = match ?? [];
  if (!rawContentType || !rawPayload) throw { status: 400, message: "图片格式无效" };
  const contentType = rawContentType.includes("svg") ? "image/png" : rawContentType;
  const buffer = Buffer.from(rawPayload, "base64");
  if (!contentType.startsWith("image/") || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw { status: 413, message: "图片需为位图且不超过 4MB" };
  }
  const compression = await readTenantImageCompression(prisma, tenantId);
  const limits = resolveImageUploadLimits({ maxSizeMb: compression.maxSizeMb, compressionEnabled: compression.enabled });
  if (buffer.byteLength > limits.sourceMaxBytes) {
    throw { status: 413, message: buildImageSourceSizeErrorMessage({ compressionEnabled: compression.enabled, maxSizeMb: compression.maxSizeMb }) };
  }
  const finalBuffer = await compressImageBuffer(buffer, contentType, compression);
  const sizeValidation = validateProcessedImageSize(finalBuffer.byteLength, compression.maxSizeMb);
  if (!sizeValidation.ok) throw { status: sizeValidation.status, message: sizeValidation.message };
  const attachment = await uploadAttachmentBytes({ config, tenantId, kind: "image", contentType, fileName, body: finalBuffer });
  return { key: attachment.key, url: attachment.url, fileName: attachment.fileName, contentType: attachment.contentType, size: attachment.size } satisfies CampaignAttachment;
}

export function registerCampaignRoutes(app: FastifyInstance, config: CampuxConfig, oneBot?: OneBotRuntime) {
  app.post("/api/campaigns", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const tenantId = context.selectedTenant.id;
    const pluginConfig = await readTenantPluginConfig(prisma, tenantId);
    const plugin = pluginConfig.campaigns;
    if (!plugin.enabled) return reply.code(403).send({ message: "投票竞选未开启" });

    let body: z.infer<typeof createBodySchema>;
    try {
      body = createBodySchema.parse(request.body ?? {});
    } catch (error) {
      return reply.code(400).send({ message: errorMessageOf(error) });
    }
    if (body.anonymous && !plugin.allowAnonymousCreate) {
      return reply.code(400).send({ message: "当前租户不允许匿名发起竞选" });
    }
    if (new Set(body.options.map((entry) => entry.label)).size !== body.options.length) {
      return reply.code(400).send({ message: "选项内容不能重复" });
    }
    const activeCount = await prisma.campaign.count({
      where: { tenantId, authorId: context.user.id, status: { in: ["pending_approval", "running"] } },
    });
    if (activeCount >= plugin.maxActivePerUser) {
      return reply.code(409).send({ message: `你最多同时发起 ${plugin.maxActivePerUser} 个竞选` });
    }

    const uploadedKeys: string[] = [];
    try {
      let cover: CampaignAttachment | null = null;
      if (body.cover) {
        cover = await uploadImageDataUrl(config, tenantId, body.cover, "campaign-cover.jpg");
        uploadedKeys.push(cover.key);
      }
      const optionAttachments: Array<CampaignAttachment | null> = [];
      for (const [index, entry] of body.options.entries()) {
        optionAttachments.push(entry.image
          ? await uploadImageDataUrl(config, tenantId, entry.image, `campaign-option-${index + 1}.jpg`)
          : null);
        if (optionAttachments[index]) uploadedKeys.push(optionAttachments[index]!.key);
      }
      const created = await runWithActiveTenantLease(prisma, tenantId, async (transaction) => {
        const tenant = await transaction.tenant.findUnique({
          where: { id: tenantId },
          select: { nextCampaignDisplayId: true },
        });
        const displayId = tenant?.nextCampaignDisplayId ?? 1;
        await transaction.tenant.update({
          where: { id: tenantId },
          data: { nextCampaignDisplayId: displayId + 1 },
        });
        const campaign = await transaction.campaign.create({
          data: {
            tenantId,
            displayId,
            authorId: context.user.id,
            title: body.title,
            coverAttachment: toAttachmentJson(cover),
            anonymous: Boolean(body.anonymous),
            votesPerPerson: body.votesPerPerson,
            allowStackOnOption: body.allowStackOnOption,
            showVoterDetails: body.showVoterDetails,
            durationHours: body.durationHours,
            status: "pending_approval",
            options: {
              create: body.options.map((entry, index) => ({
                sortOrder: index,
                label: entry.label,
                ...(optionAttachments[index] ? { imageAttachment: toAttachmentJson(optionAttachments[index]) } : {}),
              })),
            },
          },
        });
        await writeAuditLog({
          tenantId,
          actorId: context.user.id,
          action: "campaign.create",
          targetType: "campaign",
          targetId: campaign.id,
          detail: { displayId },
        }, transaction);
        return campaign;
      });
      if (!created.active) {
        await deleteAttachmentObjects(config, uploadedKeys).catch(() => undefined);
        return reply.code(409).send({ message: "校园墙已暂停或归档" });
      }
      oneBot?.notifyNewCampaign(created.value.id).catch(() => undefined);
      return toCampaignListItem(created.value as unknown as CampaignRow);
    } catch (error) {
      await deleteAttachmentObjects(config, uploadedKeys).catch(() => undefined);
      return reply.code(statusOf(error)).send({ message: errorMessageOf(error) });
    }
  });

  app.get("/api/campaigns", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const query = listQuerySchema.parse(request.query);
    const now = new Date();
    const where = buildListWhere(context.selectedTenant.id, query.filter, query.q);
    const [total, rows] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        include: { options: true },
        orderBy: query.filter === "ended" || query.filter === "pending" ? { createdAt: "desc" } : { endsAt: "asc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]) as [number, unknown[]];
    return {
      items: (rows as unknown[]).map((row: unknown) => toCampaignListItem(row as CampaignRow)),
      pagination: { page: query.page, limit: query.limit, total },
    };
  });

  app.get("/api/campaigns/:id", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = paramsSchema.parse(request.params);
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, tenantId: context.selectedTenant.id },
      include: { options: { include: { votes: { include: { voter: { select: { displayName: true, qqUin: true } } } } } } },
    });
    if (!campaign) return reply.code(404).send({ message: "竞选不存在" });
    const effectiveStatus = campaign.status === "running" && campaign.endsAt && campaign.endsAt <= new Date() ? "ended" : campaign.status;
    const myVoteAgg = await prisma.campaignVote.aggregate({
      where: { campaignId: campaign.id, voterId: context.user.id },
      _sum: { count: true },
    });
    const myVotedCount = myVoteAgg._sum.count ?? 0;
    const remainingVotes = campaign.votesPerPerson - myVotedCount;
    return {
      ...toCampaignListItem(campaign as unknown as CampaignRow),
      effectiveStatus,
      myVotedCount,
      canVote: effectiveStatus === "running" && remainingVotes > 0,
      canAddVote: effectiveStatus === "running" && remainingVotes > 0 && campaign.allowStackOnOption,
      options: campaign.options
        .slice()
        .sort((left: CampaignOptionRow, right: CampaignOptionRow) => right.voteTotal - left.voteTotal)
        .map((entry: CampaignOptionRow, rankIndex: number) => ({
          id: entry.id,
          label: entry.label,
          voteTotal: entry.voteTotal,
          rank: rankIndex + 1,
          imageAttachment: attachmentToJsonValue(attachmentFromJson(entry.imageAttachment)),
          voters: campaign.showVoterDetails
            ? entry.votes
                .map((vote: { count: number; voter: { displayName: string | null; qqUin: bigint } | null }) => ({ count: vote.count, voter: vote.voter }))
                .sort((left: { count: number }, right: { count: number }) => right.count - left.count)
            : [],
        })),
    };
  });

  app.post("/api/campaigns/:id/votes", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "submitter");
    const params = paramsSchema.parse(request.params);
    const body = voteBodySchema.parse(request.body ?? {});
    const campaign = await prisma.campaign.findFirst({ where: { id: params.id, tenantId: context.selectedTenant.id } });
    if (!campaign) return reply.code(404).send({ message: "竞选不存在" });
    const option = await prisma.campaignOption.findFirst({ where: { id: body.optionId, campaignId: campaign.id } });
    if (!option) return reply.code(404).send({ message: "选项不存在" });
    if (campaign.status !== "running" || (campaign.endsAt && campaign.endsAt <= new Date())) {
      return reply.code(409).send({ message: "竞选已结束或不可投票" });
    }
    const result = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => {
      const existing = await transaction.campaignVote.findUnique({
        where: { campaignId_voterId_optionId: { campaignId: campaign.id, voterId: context.user.id, optionId: option.id } },
      });
      const totalVoted = await transaction.campaignVote.aggregate({
        where: { campaignId: campaign.id, voterId: context.user.id },
        _sum: { count: true },
      });
      const used = totalVoted._sum.count ?? 0;
      if (used + body.count > campaign.votesPerPerson) {
        throw { status: 409, message: `你本竞选最多共投 ${campaign.votesPerPerson} 票` };
      }
      await transaction.campaignOption.update({ where: { id: option.id }, data: { voteTotal: { increment: body.count } } });
      if (existing) {
        return transaction.campaignVote.update({ where: { id: existing.id }, data: { count: existing.count + body.count } });
      }
      return transaction.campaignVote.create({
        data: { campaignId: campaign.id, optionId: option.id, voterId: context.user.id, count: body.count },
      });
    });
    if (!result.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    return { ok: true };
  });

  app.post("/api/campaigns/:id/takedown", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "admin");
    const params = paramsSchema.parse(request.params);
    const campaign = await prisma.campaign.findFirst({ where: { id: params.id, tenantId: context.selectedTenant.id } });
    if (!campaign) return reply.code(404).send({ message: "竞选不存在" });
    if (campaign.status !== "running") return reply.code(409).send({ message: "只有进行中的竞选可以下架" });
    const updated = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => {
      const row = await transaction.campaign.update({
        where: { id: campaign.id },
        data: { status: "taken_down", takenDownAt: new Date(), takenDownById: context.user.id },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "campaign.takedown",
        targetType: "campaign",
        targetId: campaign.id,
        detail: { displayId: campaign.displayId },
      }, transaction);
      return row;
    });
    if (!updated.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    oneBot?.notifyCampaignTakenDown(updated.value.id, context.user.id).catch(() => undefined);
    return { ok: true };
  });

  app.post("/api/campaigns/:id/approve", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = paramsSchema.parse(request.params);
    const target = await prisma.campaign.findFirst({ where: { id: params.id, tenantId: context.selectedTenant.id, status: "pending_approval" } });
    if (!target) return reply.code(404).send({ message: "竞选不存在或已非待审核" });
    const result = await runWithActiveTenantLease(prisma, context.selectedTenant.id, async (transaction) => {
      const row = await transaction.campaign.update({
        where: { id: target.id },
        data: { status: "running", startsAt: new Date(), endsAt: new Date(Date.now() + target.durationHours * 3600 * 1000) },
      });
      await writeAuditLog({
        tenantId: context.selectedTenant.id,
        actorId: context.user.id,
        action: "campaign.approve",
        targetType: "campaign",
        targetId: target.id,
        detail: { displayId: target.displayId },
      }, transaction);
      return row;
    });
    if (!result.active) return reply.code(409).send({ message: "校园墙已暂停或归档" });
    oneBot?.notifyCampaignApproved(result.value.id).catch(() => undefined);
    return { ok: true };
  });

  app.post("/api/campaigns/:id/reject", async (request, reply) => {
    const context = await requireReadyTenant(request, reply, "reviewer");
    const params = paramsSchema.parse(request.params);
    const body = rejectBodySchema.parse(request.body ?? {});
    const campaign = await prisma.campaign.findFirst({ where: { id: params.id, tenantId: context.selectedTenant.id, status: "pending_approval" } });
    if (!campaign) return reply.code(404).send({ message: "竞选不存在或已非待审核" });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "rejected", rejectReason: body.reason } });
    return { ok: true };
  });
}

function statusOf(error: unknown): number {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return 400;
}

function errorMessageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，请重试";
}

type CampaignOptionRow = {
  id: string;
  sortOrder: number;
  label: string;
  imageAttachment: unknown;
  voteTotal: number;
  votes: Array<{ count: number; voter: { displayName: string | null; qqUin: bigint } | null }>;
};

type CampaignRow = {
  id: string;
  tenantId: string;
  displayId: number;
  authorId: string;
  title: string;
  coverAttachment: unknown;
  anonymous: boolean;
  votesPerPerson: number;
  allowStackOnOption: boolean;
  showVoterDetails: boolean;
  durationHours: number;
  status: string;
  rejectReason: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  takenDownAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  options: CampaignOptionRow[];
};

function attachmentFromJson(value: unknown): CampaignAttachment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.key !== "string" || typeof item.url !== "string") return null;
  return {
    key: item.key,
    url: item.url,
    fileName: typeof item.fileName === "string" ? item.fileName : "image.jpg",
    contentType: typeof item.contentType === "string" ? item.contentType : "image/jpeg",
    size: typeof item.size === "number" ? item.size : 0,
  };
}

function attachmentToJsonValue(attachment: CampaignAttachment | null): unknown {
  return attachment ? { key: attachment.key, url: attachment.url } : null;
}

function toCampaignListItem(campaign: CampaignRow) {
  return {
    id: campaign.id,
    displayId: campaign.displayId,
    title: campaign.title,
    status: campaign.status,
    anonymous: campaign.anonymous,
    votesPerPerson: campaign.votesPerPerson,
    allowStackOnOption: campaign.allowStackOnOption,
    showVoterDetails: campaign.showVoterDetails,
    durationHours: campaign.durationHours,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    rejectReason: campaign.rejectReason,
    takenDownAt: campaign.takenDownAt,
    createdAt: campaign.createdAt,
    coverAttachment: attachmentToJsonValue(attachmentFromJson(campaign.coverAttachment)),
    options: campaign.options
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((entry: CampaignOptionRow) => ({
        id: entry.id,
        sortOrder: entry.sortOrder,
        label: entry.label,
        voteTotal: entry.voteTotal,
        imageAttachment: attachmentToJsonValue(attachmentFromJson(entry.imageAttachment)),
      })),
  };
}
