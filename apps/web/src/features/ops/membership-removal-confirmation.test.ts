import { describe, expect, test } from "bun:test";
import { buildMembershipRemovalConfirmation } from "./membership-removal-confirmation";

describe("buildMembershipRemovalConfirmation", () => {
  test("warns clearly when an operator removes their own access", () => {
    expect(buildMembershipRemovalConfirmation({
      actorUserId: "user-1",
      targetUserId: "user-1",
      targetLabel: "ShanFishDev",
      tenantName: "好难猜啊",
      role: "admin",
      roleLabel: "管理员",
    })).toBe("你正在移除自己在「好难猜啊」的管理员身份。确认继续？如果这是最后一名管理员，系统会阻止操作。");
  });

  test("identifies the target when removing another user's access", () => {
    expect(buildMembershipRemovalConfirmation({
      actorUserId: "user-1",
      targetUserId: "user-2",
      targetLabel: "AnotherOperator",
      tenantName: "好难猜啊",
      role: "admin",
      roleLabel: "管理员",
    })).toBe("确认移除 AnotherOperator 在「好难猜啊」的管理员身份？如果这是最后一名管理员，系统会阻止操作。");
  });
});
