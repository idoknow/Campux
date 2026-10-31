import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchSchoolEntities } from "./ai-review.js";

describe("school entity dictionary search", () => {
  const rows = [
    { id: "1", name: "North Library", aliases: ["北图书馆", "N-Lib"] },
    { id: "2", name: "South Hall", aliases: ["south library"] },
    { id: "3", name: "South Lab", aliases: ["南实验室"] },
  ];

  it("matches names and aliases without provider-specific JSON filters", () => {
    assert.deepEqual(searchSchoolEntities(rows, "北图书馆"), [rows[0]]);
    assert.deepEqual(searchSchoolEntities(rows, "north"), [rows[0]]);
    assert.deepEqual(searchSchoolEntities(rows, "SOUTH LIBRARY"), [rows[1]]);
  });

  it("returns all rows for an empty query", () => {
    assert.deepEqual(searchSchoolEntities(rows, ""), rows);
  });
});
