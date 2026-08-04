import type { CampuxPlugin, PluginContext } from "@campux/plugin";

/**
 * 审核通知插件。
 *
 * 监听审核事件（通过/拒绝），记录审核操作日志。
 * 可作为扩展审核通知（如邮件、webhook）的起点。
 */
export const reviewNotifyPlugin: CampuxPlugin = {
  name: "campux-plugin-review-notify",
  version: "1.0.0",
  description: "审核事件通知插件：监听审核通过/拒绝事件并记录日志",

  hooks: {
    onInit(ctx: PluginContext) {
      ctx.logger.info("审核通知插件初始化");

      // 订阅审核通过事件
      ctx.events.on("review:approved", (event) => {
        ctx.logger.info(
          `[审核通过] tenant=${event.tenantId} post=${event.postId} reviewer=${event.reviewerId}`
        );
        // 可在此处扩展：发送钉钉/飞书/邮件通知
      });

      // 订阅审核拒绝事件
      ctx.events.on("review:rejected", (event) => {
        ctx.logger.info(
          `[审核拒绝] tenant=${event.tenantId} post=${event.postId} reviewer=${event.reviewerId} reason=${event.reason ?? "无"}`,
        );
        // 可在此处扩展：通知投稿人审核结果
      });

      // 订阅稿件发布事件
      ctx.events.on("post:published", (event) => {
        ctx.logger.info(
          `[稿件已发布] tenant=${event.tenantId} post=${event.postId}`,
        );
      });

      // 注册一个后台 worker：每小时统计审核数据
      ctx.queue.registerWorker(
        "review-stats",
        async () => {
          const now = new Date();
          const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
          try {
            const count = await ctx.db.auditLog.count({
              where: {
                action: { in: ["review.approve", "review.reject"] },
                createdAt: { gte: oneHourAgo },
              },
            });
            ctx.logger.info(`过去一小时审核操作数: ${count}`);
          } catch (err) {
            ctx.logger.error("统计审核数据失败:", err);
          }
        },
        60 * 60 * 1000, // 每小时执行一次
      );
    },

    onReady(ctx: PluginContext) {
      ctx.logger.info("审核通知插件已就绪");
    },

    onClose(ctx: PluginContext) {
      ctx.logger.info("审核通知插件已关闭");
    },
  },
};