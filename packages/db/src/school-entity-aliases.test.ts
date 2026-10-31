import { describe, expect, it } from "bun:test";
import { normalizeSchoolEntityAlias, schoolEntityAliasRows, syncSchoolEntityAliases } from "./school-entity-aliases";

describe("school entity aliases", () => {
  it("normalizes unicode, whitespace, and case", () => {
    expect(normalizeSchoolEntityAlias("  ＡＢＣ  Campus  ")).toBe("abc campus");
  });

  it("backfills valid distinct aliases from JSON values", () => {
    const rows = schoolEntityAliasRows([{ id: "e1", tenantId: "t1", aliases: '["North Hall", " north  hall ", "", 1]' }]);
    expect(rows.map(({ value, normalized }) => [value, normalized])).toEqual([["North Hall", "north hall"]]);
  });

  it("replaces rows with a deduplicated tenant/entity-scoped delete then insert", async () => {
    const calls: unknown[] = [];
    const tx = { schoolEntityAlias: {
      deleteMany: async (args: unknown) => { calls.push(["delete", args]); },
      createMany: async (args: unknown) => { calls.push(["create", args]); },
    } };
    await syncSchoolEntityAliases(tx, "t1", "e1", ["East", " east ", "West"]);
    expect(calls[0]).toEqual(["delete", { where: { tenantId: "t1", entityId: "e1" } }]);
    expect((calls[1] as [string, { data: unknown[] }])[1].data).toHaveLength(2);
  });
});
