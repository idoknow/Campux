import { describe, expect, test } from "bun:test";
import { resolveDbProvider } from "./provider";

describe("resolveDbProvider", () => {
  test("未设置 DATABASE_URL → sqlite（零依赖默认）", () => {
    expect(resolveDbProvider(undefined)).toBe("sqlite");
    expect(resolveDbProvider("")).toBe("sqlite");
    expect(resolveDbProvider("   ")).toBe("sqlite");
  });

  test("file: / sqlite: scheme → sqlite", () => {
    expect(resolveDbProvider("file:./data/campux.db")).toBe("sqlite");
    expect(resolveDbProvider("file:/abs/path.db")).toBe("sqlite");
    expect(resolveDbProvider("sqlite://./x.db")).toBe("sqlite");
    expect(resolveDbProvider("sqlite:/x.db")).toBe("sqlite");
  });

  test("以 .db / .sqlite 结尾 → sqlite", () => {
    expect(resolveDbProvider("/var/lib/campux/campux.db")).toBe("sqlite");
    expect(resolveDbProvider("data/app.sqlite")).toBe("sqlite");
  });

  test("postgres / postgresql scheme → postgresql", () => {
    expect(resolveDbProvider("postgresql://u:p@localhost:5432/db")).toBe("postgresql");
    expect(resolveDbProvider("postgres://u:p@host/db")).toBe("postgresql");
  });

  test("CAMPUX_DB_PROVIDER 显式覆盖优先于 URL 推断", () => {
    // 显式 sqlite 即便给了 pg URL
    expect(resolveDbProvider("postgresql://u@h/db", "sqlite")).toBe("sqlite");
    // 显式 postgresql 即便给了 file URL
    expect(resolveDbProvider("file:./x.db", "postgresql")).toBe("postgresql");
    // postgres 别名归一化
    expect(resolveDbProvider("file:./x.db", "postgres")).toBe("postgresql");
    // 大小写不敏感
    expect(resolveDbProvider("file:./x.db", "POSTGRESQL")).toBe("postgresql");
  });

  test("无效 explicit 值回退到 URL 推断", () => {
    expect(resolveDbProvider("file:./x.db", "garbage")).toBe("sqlite");
    expect(resolveDbProvider("postgresql://h/db", "")).toBe("postgresql");
  });
});
