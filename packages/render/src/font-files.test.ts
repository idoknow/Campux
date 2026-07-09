import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FONT_FILE_MAP } from "@campux/domain";
import { expect, test } from "bun:test";

import { getRenderableFontCss, getRenderableFontFiles } from "./index";

test("render font files stay in sync with domain font options", () => {
  expect(getRenderableFontFiles()).toEqual(FONT_FILE_MAP);
});

test("render font css only includes the selected font", () => {
  const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const fontDir = path.join(projectRoot, "font");
  try {
    mkdirSync(fontDir, { recursive: true });
    writeFileSync(path.join(fontDir, "chengmingshouxieti.ttf"), "selected-font");
    writeFileSync(path.join(fontDir, "hanchanbanyuanti.ttf"), "other-font");

    const css = getRenderableFontCss("chengmingshouxieti");

    expect(css).toContain('font-family: "chengmingshouxieti"');
    expect(css).toContain(Buffer.from("selected-font").toString("base64"));
    expect(css).not.toContain("hanchanbanyuanti");
    expect(css).not.toContain(Buffer.from("other-font").toString("base64"));
  } finally {
    rmSync(fontDir, { force: true, recursive: true });
  }
});
