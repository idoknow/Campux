import type { Prisma } from "@campux/db";
import { prisma } from "./prisma";
import { readTenantPluginConfig } from "./tenant-plugin-config";

/**
 * 无 Bot 模式（operate_mode=manual）的「进站通道」判定。
 *
 * 机器人模式下普通用户靠私聊墙号自动建号进站；无 Bot 模式没有这条路径，
 * 必须至少有一条自助注册通道，否则墙开了但没人能注册。
 *
 * **只有一个真正的进站通道：游客投稿插件**（QQ 号 + 用户名 + 密码自助注册）。
 *
 * 聚合登录**不算进站通道**：它的定位是「给已经存在的 Campux 账号额外绑一种登录方式」，
 * 前提是该账号已经存在。把聚合登录算作进站，会让「墙开了但没人能注册」被误判为正常。
 *
 * 没有任何进站通道时，管理员也无法手动补建账号（`POST /api/admin/members` 要求账号已存在），
 * 所以在切换运营模式时就要拦住或至少明确提示。
 */
export type TenantIngressAvailability = {
  guestSubmission: boolean;
  /** 聚合登录是否开启（仅作展示参考，**不计入 `available`**）。 */
  aggregateLogin: boolean;
  /** 是否存在真正的自助注册通道 */
  available: boolean;
};

export function readTenantIngressAvailability(config: {
  guestSubmission?: { enabled?: boolean } | undefined;
  aggregateLogin?: { enabled?: boolean; autoCreateAccount?: boolean } | undefined;
}): TenantIngressAvailability {
  const guestSubmission = config.guestSubmission?.enabled === true;
  const aggregateLogin = config.aggregateLogin?.enabled === true;
  // 进站只认游客投稿：聚合登录用于给既有账号绑定登录方式，不产生新账号入口。
  return { guestSubmission, aggregateLogin, available: guestSubmission };
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
  "无 Bot 模式需要开启「游客投稿」：这是唯一能让新同学自助注册的通道"
  + "（QQ 号 + 用户名 + 密码）。聚合登录只是给已存在的账号加一种登录方式，不能用来注册新账号。"
  + "未开启游客投稿时，普通用户无法注册进入本墙，管理员也无法代为创建账号。";
