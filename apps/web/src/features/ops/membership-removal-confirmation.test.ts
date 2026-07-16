import { describe, expect, test } from "bun:test";
import {
  buildMembershipRemovalConfirmation,
  buildMembershipRoleChangeConfirmation,
} from "./membership-removal-confirmation";

describe("buildMembershipRoleChangeConfirmation", () => {
  test("warns before an admin demotes themselves", () => {
    expect(buildMembershipRoleChangeConfirmation({
      actorUserId: "user-1",
      targetUserId: "user-1",
      tenantName: "好难猜啊",
      currentRole: "admin",
      nextRole: "reviewer",
    })).toBe("你正在将自己在「好难猜啊」的身份从管理员改为审核员，将失去管理员权限。确认继续？如果这是最后一名管理员，系统会阻止操作。");
  });

  test("does not prompt for another user's role change", () => {
    expect(buildMembershipRoleChangeConfirmation({
      actorUserId: "user-1",
      targetUserId: "user-2",
      tenantName: "好难猜啊",
      currentRole: "admin",
      nextRole: "reviewer",
    })).toBeNull();
  });

  test("does not prompt when the actor keeps admin access", () => {
    expect(buildMembershipRoleChangeConfirmation({
      actorUserId: "user-1",
      targetUserId: "user-1",
      tenantName: "好难猜啊",
      currentRole: "admin",
      nextRole: "admin",
    })).toBeNull();
  });
});

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
