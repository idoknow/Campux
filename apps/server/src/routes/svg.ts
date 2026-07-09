import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { FONT_FILE_MAP } from "@campux/domain";
import { z } from "zod";
import { readSvgAvatarContent } from "../lib/svg-avatars";

const svgParamsSchema = z.object({
  filename: z.string().min(1),
});

const fontParamsSchema = z.object({
  filename: z.string().min(1),
});

function getBundledFontDir() {
  return process.env.CAMPUX_FONT_DIR || "/app/font";
}

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

  app.get("/api/fonts/:filename", async (request, reply) => {
    const { filename } = fontParamsSchema.parse(request.params);

    if (filename.includes("..") || filename.includes("/")) {
      return reply.code(400).send({ message: "Invalid filename" });
    }

    const allowed = new Set(Object.values(FONT_FILE_MAP));
    if (!allowed.has(filename)) {
      return reply.code(404).send({ message: "Font not found" });
    }

    const filePath = join(getBundledFontDir(), filename);
    if (!existsSync(filePath)) {
      return reply.code(404).send({ message: "Font not found" });
    }

    reply.header("Content-Type", filename.endsWith(".otf") ? "font/otf" : "font/ttf");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(createReadStream(filePath));
  });
}
