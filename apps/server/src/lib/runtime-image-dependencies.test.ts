import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dockerfilePath = fileURLToPath(new URL("../../../../Dockerfile", import.meta.url));

describe("server runtime image dependencies", () => {
  test("installs ffprobe for server-side video validation", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const runtimeStage = dockerfile.split(/\bAS runtime\b/)[1];

    expect(runtimeStage).toBeDefined();
    expect(runtimeStage).toMatch(/\bapk add\b[^\n]*\bffmpeg\b/);
  });
});
