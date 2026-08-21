import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./PostsPage.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

describe("post card custom colors in dark mode", () => {
  test("marks every author-colored card surface for a dark-mode override", () => {
    const customBackgroundUses = source.match(/style=\{cardBg \?/g) ?? [];
    const themedSurfaceUses = source.match(/post-themed-surface/g) ?? [];

    expect(customBackgroundUses.length).toBeGreaterThan(0);
    expect(themedSurfaceUses).toHaveLength(customBackgroundUses.length);
    expect(styles).toMatch(/\.dark \.post-themed-surface\s*\{[^}]*background:/s);
    expect(styles).toMatch(/\.dark \.post-themed-surface\s*\{[^}]*!important/s);
  });

  test("marks custom post text so its light-mode color cannot reduce dark-mode contrast", () => {
    const customTextUses = source.match(/style=\{textColor \?/g) ?? [];
    const themedTextUses = source.match(/post-themed-text/g) ?? [];

    expect(customTextUses.length).toBeGreaterThan(0);
    expect(themedTextUses).toHaveLength(customTextUses.length);
    expect(styles).toMatch(/\.dark \.post-themed-text\s*\{[^}]*color:/s);
    expect(styles).toMatch(/\.dark \.post-themed-text\s*\{[^}]*!important/s);
  });
});
