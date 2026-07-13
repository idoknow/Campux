import { describe, expect, it } from "bun:test";
import { formatOfficialQqIdReply, isOfficialQqIdCommand } from "./official-qq-gateway";

describe("QQ 官方机器人 /id 命令", () => {
  it("识别频道内直接或带 @ 前缀的 /id", () => {
    expect(isOfficialQqIdCommand("/id")).toBe(true);
    expect(isOfficialQqIdCommand(" <@!123456> /ID ")).toBe(true);
    expect(isOfficialQqIdCommand("/id extra")).toBe(false);
  });

  it("返回当前 guild、子频道和消息 ID", () => {
    expect(formatOfficialQqIdReply({ id: "message-1", guild_id: "guild-1", channel_id: "channel-1" })).toBe(
      "当前频道信息\nguild_id：guild-1\nchannel_id：channel-1\nmessage_id：message-1",
    );
  });
});
