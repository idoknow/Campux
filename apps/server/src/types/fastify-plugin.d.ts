import type { EventBus } from "@campux/plugin";

declare module "fastify" {
  interface FastifyInstance {
    pluginEvents: EventBus;
  }
}