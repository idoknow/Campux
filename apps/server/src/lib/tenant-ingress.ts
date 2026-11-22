import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";
import { readTenantPluginConfig } from "./tenant-plugin-config";

/**
 * 无 Bot 模式（operate_mode=manual）的「进站通道」判定。
 *
 * 机器人模式下普通用户靠私聊墙号自动建号进站；无 Bot 模式没有这条路径，
 * 必须至少有一条自助通道，否则墙开了但没人能注册：
 *   1. 游客投稿插件：QQ 号 + 用户名 + 密码自助注册；
 *   2. 聚合登录 + autoCreateAccount：首次扫码自动建号。
 *
 * 两条都没有时，管理员也无法手动补建账号（`POST /api/admin/members` 要求账号已存在），
 * 所以在切换运营模式时就要拦住或至少明确提示。
 */
export type TenantIngressAvailability = {
  guestSubmission: boolean;
  aggregateLogin: boolean;
  /** 任一通道可用 */
  available: boolean;
};

export function readTenantIngressAvailability(config: {
  guestSubmission?: { enabled?: boolean } | undefined;
  aggregateLogin?: { enabled?: boolean; autoCreateAccount?: boolean } | undefined;
}): TenantIngressAvailability {
  const guestSubmission = config.guestSubmission?.enabled === true;
  const aggregateLogin = config.aggregateLogin?.enabled === true && config.aggregateLogin?.autoCreateAccount === true;
  return { guestSubmission, aggregateLogin, available: guestSubmission || aggregateLogin };
}

type IngressClient = typeof prisma | Prisma.TransactionClient;

/** 从数据库读取插件配置并判定进站通道。 */
export async function readTenantIngressAvailabilityFromDb(
  client: IngressClient,
  tenantId: string,
): Promise<TenantIngressAvailability> {
  return readTenantIngressAvailability(await readTenantPluginConfig(client, tenantId));
}

/** 给运营者看的提示文案（模式切换被拦截时使用）。 */
export const ingressRequiredMessage =
  "无 Bot 模式需要至少一条用户自助进站通道：请在「管理 · 插件配置」开启「游客投稿」（QQ 号 + 密码自助注册），"
  + "或开启「聚合登录」并勾选「首次扫码自动建号」。两者都没开时，普通用户无法注册进入本墙，"
  + "管理员也无法代为创建账号。";
