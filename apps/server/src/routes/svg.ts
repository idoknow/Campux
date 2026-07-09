import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readSvgAvatarContent } from "../lib/svg-avatars";

const svgParamsSchema = z.object({
  filename: z.string().min(1),
});

export function registerSvgRoutes(app: FastifyInstance) {
  /**
   * GET /api/svg/:filename - 返回指定 SVG 文件内容
   */
  app.get("/api/svg/:filename", async (request, reply) => {
    const { filename } = svgParamsSchema.parse(request.params);

    if (filename.includes("..") || filename.includes("/")) {
      return reply.code(400).send({ message: "Invalid filename" });
    }

    const content = readSvgAvatarContent(filename);
    if (!content) {
      return reply.code(404).send({ message: "SVG not found" });
    }

    reply.header("Content-Type", "image/svg+xml");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(content);
  });
}
