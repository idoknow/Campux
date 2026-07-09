import { builtInSvgAvatarContents } from "./built-in-svg-avatars";

export function readSvgAvatarContent(filename: string): string | null {
  return builtInSvgAvatarContents[filename as keyof typeof builtInSvgAvatarContents] ?? null;
}

/**
 * Read an SVG file and return it as a base64 data URL.
 * Returns `null` if the file doesn't exist or can't be read.
 */
export function readSvgAvatarDataUrl(filename: string): string | null {
  const builtInSvg = readSvgAvatarContent(filename);
  if (builtInSvg) {
    const base64 = Buffer.from(builtInSvg, "utf-8").toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  }

  return null;
}
