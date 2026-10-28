import { describe, expect, test } from "bun:test";

import { classifyConnectionLiveness } from "./onebot";

describe("classifyConnectionLiveness", () => {
  test("健康连接返回 ok", () => {
    expect(
      classifyConnectionLiveness({ present: true, fenceCurrent: true, tenantActive: true }),
    ).toBe("ok");
  });

  test("连接已被重连取代时判为 stale，不得连带停用租户", () => {
    expect(
      classifyConnectionLiveness({ present: false, fenceCurrent: true, tenantActive: true }),
    ).toBe("stale");
  });

  test("连接不在集合里时，即使 fence 或租户状态也异常，仍只按 stale 处理", () => {
    expect(
      classifyConnectionLiveness({ present: false, fenceCurrent: false, tenantActive: false }),
    ).toBe("stale");
  });

  test("fence 失效但连接仍在：租户被停用，需断开整个租户", () => {
    expect(
      classifyConnectionLiveness({ present: true, fenceCurrent: false, tenantActive: true }),
    ).toBe("tenant-gone");
  });

  test("数据库确认租户非 active：需断开整个租户", () => {
    expect(
      classifyConnectionLiveness({ present: true, fenceCurrent: true, tenantActive: false }),
    ).toBe("tenant-gone");
  });

  test("回归：present=false 的组合永远不会触发租户级停用", () => {
    for (const fenceCurrent of [true, false]) {
      for (const tenantActive of [true, false]) {
        expect(classifyConnectionLiveness({ present: false, fenceCurrent, tenantActive })).toBe(
          "stale",
        );
      }
    }
  });
});
