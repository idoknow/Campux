import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the project root by walking up from this file's location.
 * This file: apps/server/src/lib/svg-avatars.ts
 * Project root: apps/server/src/lib/../../..
 */
function resolveProjectRoot(): string {
  return path.resolve(import.meta.dirname!, "..", "..", "..");
}

function resolveSvgDir(): string {
  // standalone 单文件形态下，svg 头像被解包到临时目录并通过 CAMPUX_SVG_DIR 指定。
  if (process.env.CAMPUX_SVG_DIR) {
    return process.env.CAMPUX_SVG_DIR;
  }
  return path.join(resolveProjectRoot(), "svg");
}

/**
 * List all SVG avatar filenames available in the svg/ directory.
 */
export function listSvgAvatars(): string[] {
  const svgDir = resolveSvgDir();
  try {
    const files = readdirSync(svgDir);
    return files.filter((f) => f.endsWith(".svg")).sort();
  } catch {
    return [];
  }
}

/**
 * Read an SVG file and return it as a base64 data URL.
 * Returns `null` if the file doesn't exist or can't be read.
 */
export function readSvgAvatarDataUrl(filename: string): string | null {
  const svgDir = resolveSvgDir();
  const filePath = path.join(svgDir, filename);
  try {
    const content = readFileSync(filePath, "utf-8");
    const base64 = Buffer.from(content, "utf-8").toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  } catch {
    return null;
  }
}
