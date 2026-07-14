import { afterEach, describe, expect, it } from "bun:test";
import {
  createOfficialQqForumThread,
  listOfficialQqChannels,
  serializeOfficialQqForumRichText,
} from "./official-qq";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("QQ 官方机器人论坛子频道", () => {
  it("只返回能够接收稿件推送的论坛子频道", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "channel-list-token", expires_in: 7200 });
      }
      return Response.json([
        { id: "text-channel", guild_id: "guild-1", name: "闲聊", type: 0 },
        { id: "forum-channel", guild_id: "guild-1", name: "校园墙", type: 10007 },
        { id: "category", guild_id: "guild-1", name: "分组", type: 4 },
      ]);
    }) as typeof fetch;

    const channels = await listOfficialQqChannels({
      id: "bot-list",
      officialAppId: "10001",
      officialAppSecret: "list-secret",
    }, "guild-1");

    expect(requests).toContain("https://api.sgroup.qq.com/guilds/guild-1/channels");
    expect(channels).toEqual([{
      id: "forum-channel",
      guildId: "guild-1",
      name: "校园墙",
      type: 10007,
      parentId: null,
    }]);
  });

  it("将所选 channel_id 原样用于论坛稿件推送地址", async () => {
    const requests: Array<{ url: string; init: RequestInit | BunFetchRequestInit | undefined }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "publish-token", expires_in: 7200 });
      }
      return Response.json({ thread_id: "thread-1" });
    }) as typeof fetch;

    const result = await createOfficialQqForumThread({
      id: "bot-publish",
      officialAppId: "10002",
      officialAppSecret: "publish-secret",
    }, " selected/channel ", {
      title: " #123 ",
      content: " 稿件正文 ",
    });

    const publishRequest = requests.find((request) => request.url.startsWith("https://api.sgroup.qq.com/"));
    expect(publishRequest?.url).toBe("https://api.sgroup.qq.com/channels/selected%2Fchannel/threads");
    expect(publishRequest?.init?.method).toBe("PUT");
    expect(JSON.parse(String(publishRequest?.init?.body))).toEqual({
      title: "#123",
      content: serializeOfficialQqForumRichText("稿件正文"),
      format: 4,
    });
    expect(new Headers(publishRequest?.init?.headers).get("Authorization")).toBe("QQBot publish-token");
    expect(result.threadId).toBe("thread-1");
  });

  it("将每一行转换成独立富文本段落以保留换行", () => {
    expect(JSON.parse(serializeOfficialQqForumRichText("#10 匿名\r\n1111测试\n\n尾行"))).toEqual({
      paragraphs: [
        { elems: [{ type: 1, text: { text: "#10 匿名" } }], props: {} },
        { elems: [{ type: 1, text: { text: "1111测试" } }], props: {} },
        { elems: [], props: {} },
        { elems: [{ type: 1, text: { text: "尾行" } }], props: {} },
      ],
    });
  });

  it("将正文图片作为独立富文本图片段落追加到频道帖子", () => {
    expect(JSON.parse(serializeOfficialQqForumRichText("#10", ["https://example.com/card.png", "https://example.com/photo.jpg"]))).toEqual({
      paragraphs: [
        { elems: [{ type: 1, text: { text: "#10" } }], props: {} },
        { elems: [{ type: 2, image: { third_url: "https://example.com/card.png", width_percent: 1 } }], props: {} },
        { elems: [{ type: 2, image: { third_url: "https://example.com/photo.jpg", width_percent: 1 } }], props: {} },
      ],
    });
  });


  it("拒绝空的稿件推送子频道 ID", async () => {
    await expect(createOfficialQqForumThread({
      id: "bot-empty",
      officialAppId: "10003",
      officialAppSecret: "empty-secret",
    }, "  ", {
      title: "#123",
      content: "稿件正文",
    })).rejects.toThrow("QQ 频道 ID 为空");
  });
});