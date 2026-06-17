import { readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listSvgAvatars } from "../lib/svg-avatars";

function resolveSvgDir(): string {
  // standalone 单文件形态下，svg 头像被解包到临时目录并通过 CAMPUX_SVG_DIR 指定。
  if (process.env.CAMPUX_SVG_DIR) {
    return process.env.CAMPUX_SVG_DIR;
  }
  return path.resolve(import.meta.dirname!, "..", "..", "..", "..", "svg");
}

const svgParamsSchema = z.object({
  filename: z.string().min(1),
});

export function registerSvgRoutes(app: FastifyInstance) {
  /**
   * GET /api/svg/avatars - 返回可用匿名头像 SVG 文件名列表
   */
  app.get("/api/svg/avatars", async (_request, reply) => {
    const avatars = listSvgAvatars();
    return { avatars };
  });

  /**
   * GET /api/svg/:filename - 返回指定 SVG 文件内容
   */
  app.get("/api/svg/:filename", async (request, reply) => {
    const { filename } = svgParamsSchema.parse(request.params);

    if (filename.includes("..") || filename.includes("/")) {
      return reply.code(400).send({ message: "Invalid filename" });
    }

    const svgDir = resolveSvgDir();
    const filePath = path.join(svgDir, filename);

    try {
      const content = readFileSync(filePath, "utf-8");
      reply.header("Content-Type", "image/svg+xml");
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(content);
    } catch {
      return reply.code(404).send({ message: "SVG not found" });
    }
  });
}
