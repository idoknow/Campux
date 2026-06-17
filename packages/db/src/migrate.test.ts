import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { checksumOf, splitSqlStatements } from "./migrate";

describe("splitSqlStatements", () => {
  test("splits simple statements on semicolons", () => {
    const out = splitSqlStatements(`CREATE TABLE a (id int); INSERT INTO a VALUES (1);`);
    expect(out).toEqual(["CREATE TABLE a (id int)", "INSERT INTO a VALUES (1)"]);
  });

  test("keeps a DO $$ block intact as a single statement", () => {
    const sql = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1) THEN
    ALTER TABLE "Post" ADD COLUMN "x" text;
  END IF;
END $$;
INSERT INTO "Post" (id) VALUES (1);`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("DO $$");
    expect(out[0]).toContain("END $$");
    // the inner ';' (after ADD COLUMN, END IF) must NOT split the DO block
    expect(out[0]).toContain('ALTER TABLE "Post" ADD COLUMN "x" text;');
    expect(out[1]).toBe(`INSERT INTO "Post" (id) VALUES (1)`);
  });

  test("ignores semicolons inside single-quoted strings", () => {
    const out = splitSqlStatements(`INSERT INTO a (s) VALUES ('hello; world'); SELECT 1;`);
    expect(out).toEqual(["INSERT INTO a (s) VALUES ('hello; world')", "SELECT 1"]);
  });

  test("handles escaped single quotes inside strings", () => {
    const out = splitSqlStatements(`INSERT INTO a (s) VALUES ('it''s; fine'); SELECT 2;`);
    expect(out).toEqual(["INSERT INTO a (s) VALUES ('it''s; fine')", "SELECT 2"]);
  });

  test("ignores semicolons inside double-quoted identifiers", () => {
    const out = splitSqlStatements(`ALTER TABLE "we;ird" ADD COLUMN x int; SELECT 1;`);
    expect(out).toEqual([`ALTER TABLE "we;ird" ADD COLUMN x int`, "SELECT 1"]);
  });

  test("strips line comments but keeps statement boundaries", () => {
    const sql = `-- a comment with ; semicolon
CREATE TABLE a (id int); -- trailing
SELECT 1;`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("CREATE TABLE a (id int)");
    expect(out[1]).toContain("SELECT 1");
  });

  test("handles block comments containing semicolons", () => {
    const sql = `/* comment; with; semicolons */ CREATE TABLE a (id int); SELECT 1;`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe("SELECT 1");
  });

  test("handles tagged dollar quotes ($func$)", () => {
    const sql = `CREATE FUNCTION f() RETURNS int AS $func$ BEGIN RETURN 1; END $func$ LANGUAGE plpgsql; SELECT 1;`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("$func$");
    expect(out[0]).toContain("RETURN 1;");
  });

  test("returns empty array for blank / comment-only input", () => {
    expect(splitSqlStatements("")).toEqual([]);
    expect(splitSqlStatements("  \n  ")).toEqual([]);
    expect(splitSqlStatements("-- just a comment\n")).toEqual([]);
  });

  test("does not emit a trailing empty statement", () => {
    const out = splitSqlStatements("SELECT 1;");
    expect(out).toEqual(["SELECT 1"]);
  });
});

describe("checksumOf", () => {
  test("equals an independent sha256 hex of the raw text (prisma convention)", () => {
    const sample = "DO $$ BEGIN END $$;\n";
    const expected = createHash("sha256").update(sample, "utf8").digest("hex");
    expect(checksumOf(sample)).toBe(expected);
    expect(checksumOf(sample)).toMatch(/^[0-9a-f]{64}$/);
    expect(checksumOf("a")).not.toBe(checksumOf("b"));
  });
});
