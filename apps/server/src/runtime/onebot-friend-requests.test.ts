import { describe, expect, test } from "bun:test";
import { buildFriendRequestAutoApprovePlan, buildSetFriendAddRequestParams } from "./onebot-friend-requests";

describe("buildFriendRequestAutoApprovePlan", () => {
  const event = {
    post_type: "request",
    request_type: "friend",
    self_id: 10001,
    user_id: 20002,
    flag: "friend-request-flag",
    comment: "我是新用户",
  };

  test("returns null for non-friend request events", () => {
    expect(buildFriendRequestAutoApprovePlan({ ...event, post_type: "message" }, { enabled: true, autoFriendRequestApprovalEnabled: true })).toBeNull();
    expect(buildFriendRequestAutoApprovePlan({ ...event, request_type: "group" }, { enabled: true, autoFriendRequestApprovalEnabled: true })).toBeNull();
  });

  test("returns null when the bot switch is disabled", () => {
    expect(buildFriendRequestAutoApprovePlan(event, { enabled: true, autoFriendRequestApprovalEnabled: false })).toBeNull();
  });

  test("returns null when the bot account is disabled", () => {
    expect(buildFriendRequestAutoApprovePlan(event, { enabled: false, autoFriendRequestApprovalEnabled: true })).toBeNull();
  });

  test("builds an approval plan with randomized delay inside the configured range", () => {
    const plan = buildFriendRequestAutoApprovePlan(
      event,
      { enabled: true, autoFriendRequestApprovalEnabled: true },
      { minDelayMs: 30_000, maxDelayMs: 90_000, random: () => 0.25 },
    );

    expect(plan).toEqual({
      flag: "friend-request-flag",
      userQqUin: "20002",
      comment: "我是新用户",
      delayMs: 45_000,
    });
  });
});

describe("buildSetFriendAddRequestParams", () => {
  test("uses OneBot set_friend_add_request approval params", () => {
    expect(buildSetFriendAddRequestParams("friend-request-flag")).toEqual({
      flag: "friend-request-flag",
      approve: true,
    });
  });
});
