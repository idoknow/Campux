import { FONT_FILE_MAP } from "@campux/domain";
import { expect, test } from "bun:test";

import { getRenderableFontFiles } from "./index";

test("render font files stay in sync with domain font options", () => {
  expect(getRenderableFontFiles()).toEqual(FONT_FILE_MAP);
});
