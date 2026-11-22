import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";
import { writeAuditLog } from "./audit";

/**
 * 账号合并：把「靠私聊 Bot 建的旧账号」并入「网页注册的新账号」。
 *
 * 背景：同一个同学在无 Bot 期用网页注册了账号（QQ 号 A + 邮箱），
 * 后来又通过私聊墙号被自动建过号（QQ 号 B）。两边各有一批稿件，
 * 用户在新账号里看不到旧的，运营者统计也会分叉。
 *
 * 合并规则（安全优先）：
 * 1. 目标账号（新号）保留：QQ 号、邮箱、密码不变；
 * 2. 旧账号在当前墙的稿件与成员身份迁到新号；
 * 3. 旧账号被标记 `mergedAt` 并**不再参与登录**，数据保留可审计；
 * 4. 旧号的 QQ 号仍占用 unique 值，避免 Bot 重新建号时静默覆盖历史。
 *
 * 整个迁移在一个事务里完成。**注意**：Postgres 里事务内一条语句失败会让整个事务
 * 进入 aborted 状态，因此这里不用 `try/catch` 吞错，而是逐类关联先查后写、显式处理
 * unique 冲突。
 */

export class UserMergeError extends Error {
  constructor(
    message: string,
    readonly code: "OLD_NOT_FOUND" | "ALREADY_MERGED" | "SAME_USER" | "EMAIL_MISMATCH" | "NEW_MISSING" | "TARGET_MERGED",
  ) {
    super(message);
    this.name = "UserMergeError";
  }
}

export type MergeCandidate = {
  id: string;
  qqUin: bigint;
  email: string | null;
  displayName: string | null;
};

export type MergePreview = {
  oldUserId: string;
  oldQqUin: string;
  oldEmail: string | null;
  oldDisplayName: string | null;
  oldPostCount: number;
  newUserId: string;
  newQqUin: string;
  newEmail: string | null;
};

/** 找出「可以并入目标账号」的旧账号：未合并、不是自己。 */
export async function findMergeCandidate(
  client: typeof prisma | Prisma.TransactionClient,
  input: { targetUserId: string; oldQqUin: string },
): Promise<MergeCandidate | null> {
  let oldQqUin: bigint;
  try {
    oldQqUin = BigInt(input.oldQqUin);
  } catch {
    return null;
  }
  const old = await client.user.findUnique({
    where: { qqUin: oldQqUin },
    select: { id: true, qqUin: true, email: true, displayName: true, mergedAt: true },
  });
  if (!old || old.id === input.targetUserId || old.mergedAt !== null) {
    return null;
  }
  return { id: old.id, qqUin: old.qqUin, email: old.email, displayName: old.displayName };
}

/** 生成合并预览，供前端弹窗确认。 */
export async function buildMergePreview(input: {
  tenantId: string;
  targetUserId: string;
  oldQqUin: string;
}): Promise<MergePreview | null> {
  const target = await prisma.user.findUnique({
    where: { id: input.targetUserId },
    select: { id: true, qqUin: true, email: true },
  });
  if (!target) return null;
  const old = await findMergeCandidate(prisma, input);
  if (!old) return null;
  const oldPostCount = await prisma.post.count({
    where: { tenantId: input.tenantId, authorId: old.id },
  });
  return {
    oldUserId: old.id,
    oldQqUin: old.qqUin.toString(),
    oldEmail: old.email,
    oldDisplayName: old.displayName,
    oldPostCount,
    newUserId: target.id,
    newQqUin: target.qqUin.toString(),
    newEmail: target.email,
  };
}

/**
 * 执行合并。调用方负责先做验证码校验与权限校验。
 */
export async function mergeUserAccounts(input: {
  tenantId: string;
  targetUserId: string;
  oldQqUin: string;
  actorId: string;
}): Promise<{ mergeId: string; migratedPosts: number; migratedMemberships: number; oldQqUin: string }> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, qqUin: true, email: true, mergedAt: true },
    });
    if (!target) {
      throw new UserMergeError("当前账号不存在", "NEW_MISSING");
    }
    if (target.mergedAt !== null) {
      throw new UserMergeError("当前账号已被并入其他账号，无法作为合并目标", "TARGET_MERGED");
    }

    const old = await findMergeCandidate(tx, input);
    if (!old) {
      // 区分「不存在」与「已合并」，给出可操作的提示。
      let existing: { mergedAt: Date | null; id: string } | null = null;
      try {
        existing = await tx.user.findUnique({ where: { qqUin: BigInt(input.oldQqUin) }, select: { mergedAt: true, id: true } });
      } catch {
        existing = null;
      }
      if (existing && existing.id === target.id) {
        throw new UserMergeError("不能把账号合并到它自己", "SAME_USER");
      }
      throw new UserMergeError(
        existing?.mergedAt ? "这个旧账号已经合并过了，无需重复操作" : "没有找到这个 QQ 号对应的旧账号",
        existing?.mergedAt ? "ALREADY_MERGED" : "OLD_NOT_FOUND",
      );
    }

    // 邮箱是 unique：两个账号各自绑不同邮箱是允许的——验证码发到「旧账号的邮箱」即可证明归属，
    // 这正是「邮箱绑定的 QQ 与当前登录账号不一致时，提示并确认是否绑定」的场景。
    // 只有一种情况不能继续：旧号没有邮箱，无法验证归属。
    if (!old.email && !target.email) {
      throw new UserMergeError(
        "旧账号没有绑定邮箱，无法验证归属，请联系管理员处理",
        "EMAIL_MISMATCH",
      );
    }
    // 两边邮箱相同的极端情况：合并后旧号会释放该邮箱（旧号停用但保留记录），
    // 这里不改动新号邮箱，因此不会撞 unique。

    // ── 稿件：只迁当前墙 ──
    const postResult = await tx.post.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });

    // ── 成员身份：同墙若已有目标账号的 membership，会撞 (tenantId,userId) unique，
    // 这时删掉旧那条而不是 update。 ──
    const [oldMembership, targetMembership] = await Promise.all([
      tx.tenantMembership.findFirst({ where: { tenantId: input.tenantId, userId: old.id }, select: { id: true, role: true } }),
      tx.tenantMembership.findFirst({ where: { tenantId: input.tenantId, userId: target.id }, select: { id: true, role: true } }),
    ]);
    let migratedMemberships = 0;
    if (oldMembership) {
      if (targetMembership) {
        await tx.tenantMembership.delete({ where: { id: oldMembership.id } });
      } else {
        await tx.tenantMembership.update({ where: { id: oldMembership.id }, data: { userId: target.id } });
        migratedMemberships = 1;
      }
    }

    // ── 关注：同 (postId,userId) 可能重复，先删冲突再迁移 ──
    const oldFollows = await tx.postFollow.findMany({ where: { userId: old.id }, select: { postId: true } });
    if (oldFollows.length > 0) {
      const targetFollows = await tx.postFollow.findMany({
        where: { userId: target.id, postId: { in: oldFollows.map((f) => f.postId) } },
        select: { postId: true },
      });
      const dupes = new Set(targetFollows.map((f) => f.postId));
      const movable = oldFollows.filter((f) => !dupes.has(f.postId)).map((f) => f.postId);
      if (dupes.size > 0) {
        await tx.postFollow.deleteMany({ where: { userId: old.id, postId: { in: [...dupes] } } });
      }
      if (movable.length > 0) {
        await tx.postFollow.updateMany({ where: { userId: old.id, postId: { in: movable } }, data: { userId: target.id } });
      }
    }

    // ── 其余按墙归属的创作记录：直接改作者，没有 unique 冲突风险 ──
    await tx.tenantFeedback.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    await tx.userGraduation.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    await tx.tenantBroadcast.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    await tx.campaign.updateMany({
      where: { tenantId: input.tenantId, authorId: old.id },
      data: { authorId: target.id },
    });
    // 投票有 (campaignId, voterId) unique：同样先删冲突。
    const oldVotes = await tx.campaignVote.findMany({ where: { voterId: old.id }, select: { campaignId: true } });
    if (oldVotes.length > 0) {
      const targetVotes = await tx.campaignVote.findMany({
        where: { voterId: target.id, campaignId: { in: oldVotes.map((v) => v.campaignId) } },
        select: { campaignId: true },
      });
      const dupCampaigns = new Set(targetVotes.map((v) => v.campaignId));
      if (dupCampaigns.size > 0) {
        await tx.campaignVote.deleteMany({ where: { voterId: old.id, campaignId: { in: [...dupCampaigns] } } });
      }
      const movableVotes = oldVotes.filter((v) => !dupCampaigns.has(v.campaignId)).map((v) => v.campaignId);
      if (movableVotes.length > 0) {
        await tx.campaignVote.updateMany({ where: { voterId: old.id, campaignId: { in: movableVotes } }, data: { voterId: target.id } });
      }
    }
    // 第三方身份有 (provider, providerUserId) unique：只迁不冲突的。
    const oldIdentities = await tx.oAuthIdentity.findMany({ where: { userId: old.id }, select: { id: true, provider: true } });
    if (oldIdentities.length > 0) {
      const targetIdentities = await tx.oAuthIdentity.findMany({
        where: { userId: target.id },
        select: { provider: true },
      });
      const dupProviders = new Set(targetIdentities.map((i) => i.provider));
      const movableIdentities = oldIdentities.filter((i) => !dupProviders.has(i.provider)).map((i) => i.id);
      if (dupProviders.size > 0) {
        await tx.oAuthIdentity.deleteMany({ where: { userId: old.id, provider: { in: [...dupProviders] } } });
      }
      if (movableIdentities.length > 0) {
        await tx.oAuthIdentity.updateMany({ where: { id: { in: movableIdentities } }, data: { userId: target.id } });
      }
    }

    // 旧号停用：清空登录会话并打标记。
    // 邮箱是 unique：旧号若占用着与新号相同的邮箱，停用后必须释放，否则新号将来改绑会撞约束。
    await tx.accountSession.deleteMany({ where: { userId: old.id } });
    await tx.user.update({
      where: { id: old.id },
      data: {
        mergedAt: new Date(),
        mergedIntoUserId: target.id,
        ...(old.email !== null && old.email === target.email ? { email: null } : {}),
      },
    });

    const merge = await tx.userMerge.create({
      data: {
        tenantId: input.tenantId,
        oldUserId: old.id,
        newUserId: target.id,
        oldQqUin: old.qqUin,
        newQqUin: target.qqUin,
        oldEmail: old.email,
        migratedPosts: postResult.count,
        migratedMemberships,
      },
    });

    await writeAuditLog({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: "user.merge",
      targetType: "user",
      targetId: target.id,
      detail: {
        mergeId: merge.id,
        oldUserId: old.id,
        oldQqUin: old.qqUin.toString(),
        newUserId: target.id,
        newQqUin: target.qqUin.toString(),
        migratedPosts: postResult.count,
        migratedMemberships,
      },
    }, tx);

    return {
      mergeId: merge.id,
      migratedPosts: postResult.count,
      migratedMemberships,
      oldQqUin: old.qqUin.toString(),
    };
  }, { maxWait: 15_000, timeout: 60_000 });
}

/** 合并链最多向上追溯的层数，防御异常数据造成的环。 */
const MAX_MERGE_HOPS = 5;

/**
 * 把「可能是被合并旧号」的账号解析到最终主账号。
 *
 * 合并后旧号仍占用原 QQ 号与邮箱（用于审计与反查），所以用旧凭据登录会先查到旧号。
 * 这里沿 `mergedIntoUserId` 一直往上找到真正的主账号；主账号没被合并时原样返回。
 *
 * 返回 `redirectedFrom` 让调用方能提示「该账号已合并到新账号」。
 */
export async function resolveActiveAccount(
  client: typeof prisma | Prisma.TransactionClient,
  user: { id: string; mergedAt: Date | null; mergedIntoUserId: string | null },
): Promise<{ userId: string; redirectedFrom: string | null }> {
  if (user.mergedAt === null || !user.mergedIntoUserId) {
    return { userId: user.id, redirectedFrom: null };
  }
  const firstOldId = user.id;
  let currentId = user.mergedIntoUserId;
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop += 1) {
    const next = await client.user.findUnique({
      where: { id: currentId },
      select: { id: true, mergedAt: true, mergedIntoUserId: true },
    });
    if (!next) {
      // 主账号被删掉了：退回旧号本身，避免把用户彻底挡在门外。
      return { userId: firstOldId, redirectedFrom: null };
    }
    if (next.mergedAt === null || !next.mergedIntoUserId) {
      return { userId: next.id, redirectedFrom: firstOldId };
    }
    currentId = next.mergedIntoUserId;
  }
  return { userId: currentId, redirectedFrom: firstOldId };
}

/**
 * 登录后是否需要提示「绑定之前的账号」。 *
 * 用户的规则：管理员切换运营模式后，用户首次登录时提示；重复切换不再提示；
 * 已经绑定过邮箱、或已合并过的账号不再提示。
 *
 * 这里用 `User.email`（已绑邮箱即视为无需提示）与 `User.mergedAt` 推导，
 * 避免再加一张「已提示过」的表：绑过邮箱的账号本来就不会走「Bot 建号」路径。
 */
export function shouldPromptAccountMerge(user: { email: string | null; mergedAt: Date | null }): boolean {
  return user.email === null && user.mergedAt === null;
}
