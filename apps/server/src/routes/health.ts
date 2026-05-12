import type { FastifyInstance } from "fastify";
import type { RuntimeQueue } from "../runtime/queue";

export function registerHealthRoutes(app: FastifyInstance, queue: RuntimeQueue) {
  app.get("/api/health", async () => ({
    ok: true,
    service: "campux-next",
    queue: queue.snapshot(),
  }));
}
