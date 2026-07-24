import { afterEach, describe, expect, it } from "bun:test";
import {
  createOfficialQqForumThread,
  deleteOfficialQqForumThread,
  findOfficialQqForumThreadIdByDisplayIds,
  listOfficialQqChannels,
  OfficialQqPublishOutcomeUnknownError,
  readOfficialQqForumThreadId,
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
    expect(result.verbose).toMatchObject({
      mode: "official-qq-forum",
      appId: "10002",
      channelId: "selected/channel",
      title: "#123",
      contentLength: 4,
      imageCount: 0,
      externalId: "thread-1",
      threadId: "thread-1",
      taskId: null,
      create: { thread_id: "thread-1" },
    });
    expect((result.verbose as { publishedAt?: string }).publishedAt).toBeString();
  });

  it("兼容 QQ 发帖接口将帖子 ID 放在嵌套 thread_info 中返回", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "nested-thread-token", expires_in: 7200 });
      }
      return Response.json({
        task_id: "task-1",
        thread_info: {
          thread_id: "thread-nested-1",
          title: "#6962",
        },
      });
    }) as typeof fetch;

    const result = await createOfficialQqForumThread({
      id: "bot-nested-thread",
      officialAppId: "10005",
      officialAppSecret: "nested-thread-secret",
    }, "forum-channel", {
      title: "#6962",
      content: "稿件正文",
    });

    expect(requests).toContain("https://api.sgroup.qq.com/channels/forum-channel/threads");
    expect(result.externalId).toBe("thread-nested-1");
    expect(result.threadId).toBe("thread-nested-1");
    expect(result.taskId).toBe("task-1");
    expect(result.verbose.threadId).toBe("thread-nested-1");
    expect(result.verbose.taskId).toBe("task-1");
    expect(result.verbose.create).toMatchObject({
      task_id: "task-1",
      thread_info: { thread_id: "thread-nested-1" },
    });
  });

  it("从常见 QQ 论坛返回结构中提取可删除的帖子 ID，避免误用任务 ID", () => {
    expect(readOfficialQqForumThreadId({ thread_id: "thread-direct" })).toBe("thread-direct");
    expect(readOfficialQqForumThreadId({ threadId: "thread-camel" })).toBe("thread-camel");
    expect(readOfficialQqForumThreadId({ id: "task-not-thread" })).toBeNull();
    expect(readOfficialQqForumThreadId({
      task_id: "task-1",
      data: {
        thread_info: {
          thread_id: "thread-nested-2",
        },
      },
    })).toBe("thread-nested-2");
  });

  it("通过帖子列表用稿件 ID 匹配 task_id-only 发帖响应对应的帖子 ID", async () => {
    const requests: Array<{ url: string; init: RequestInit | BunFetchRequestInit | undefined }> = [];
    let listCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "task-only-token", expires_in: 7200 });
      }
      if (init?.method === "PUT") {
        return Response.json({ task_id: "1645413752912602306", create_time: "1645503180" });
      }
      listCalls += 1;
      if (listCalls === 1) {
        return Response.json({ threads: [], is_finish: 1 });
      }
      return Response.json({
        threads: [
          {
            thread_info: {
              thread_id: "thread-other",
              title: "#6961",
              content: serializeOfficialQqForumRichText("其他稿件"),
            },
          },
          {
            thread_info: {
              thread_id: "thread-6962",
              title: "沙塘大道第一墙 #6962",
              content: serializeOfficialQqForumRichText("只通过标题里的稿件号匹配"),
            },
          },
        ],
        is_finish: 1,
      });
    }) as typeof fetch;

    const result = await createOfficialQqForumThread({
      id: "bot-task-only",
      officialAppId: "10006",
      officialAppSecret: "task-only-secret",
    }, "forum-channel", {
      title: "#6962",
      content: "稿件正文",
      matchDisplayIds: [6962],
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://bots.qq.com/app/getAppAccessToken",
      "https://api.sgroup.qq.com/channels/forum-channel/threads",
      "https://api.sgroup.qq.com/channels/forum-channel/threads",
      "https://api.sgroup.qq.com/channels/forum-channel/threads",
    ]);
    expect(requests[1]?.init?.method).toBe("GET");
    expect(requests[2]?.init?.method).toBe("PUT");
    expect(requests[3]?.init?.method).toBe("GET");
    expect(result.externalId).toBe("thread-6962");
    expect(result.threadId).toBe("thread-6962");
    expect(result.taskId).toBe("1645413752912602306");
    expect(result.verbose.create).toEqual({ task_id: "1645413752912602306", create_time: "1645503180" });
  });

  it("在创建请求传输结果不明时通过帖子列表收敛成功，避免自动重发", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    let listCalls = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "ambiguous-create-token", expires_in: 7200 });
      }
      if (method === "PUT") {
        throw new TypeError("fetch failed");
      }
      listCalls += 1;
      return Response.json({
        threads: listCalls === 1 ? [] : [{
          thread_info: {
            thread_id: "thread-777",
            title: "#777",
            content: serializeOfficialQqForumRichText("稿件正文"),
          },
        }],
      });
    }) as typeof fetch;

    await expect(createOfficialQqForumThread({
      id: "bot-ambiguous-create",
      officialAppId: "10008",
      officialAppSecret: "ambiguous-create-secret",
    }, "forum-channel", {
      title: "#777",
      content: "稿件正文",
      matchDisplayIds: [777],
    })).resolves.toMatchObject({
      externalId: "thread-777",
      threadId: "thread-777",
      taskId: null,
    });

    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1);
    expect(requests.filter((request) => request.method === "GET" && request.url.includes("/threads"))).toHaveLength(2);
  });

  it("令牌请求失败发生在 create 之前时保留可重试错误，不误标为远端结果未知", async () => {
    const tokenError = new TypeError("token transport failed");
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      throw tokenError;
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await createOfficialQqForumThread({
        id: "bot-token-failure",
        officialAppId: "10009",
        officialAppSecret: "token-failure-secret",
      }, "forum-channel", {
        title: "#778",
        content: "稿件正文",
        matchDisplayIds: [778],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(tokenError);
    expect(caught).not.toBeInstanceOf(OfficialQqPublishOutcomeUnknownError);
    expect(requests).toEqual(["https://bots.qq.com/app/getAppAccessToken"]);
  });

  it("批量发前查重不会因只命中一个稿件号而跳过整批 create", async () => {
    const methods: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "strict-batch-token", expires_in: 7200 });
      }
      methods.push(init?.method ?? "GET");
      if (init?.method === "PUT") {
        return Response.json({ thread_id: "thread-new-batch" });
      }
      return Response.json({
        threads: [{
          thread_info: {
            thread_id: "thread-unrelated",
            title: "历史单稿 #800",
            content: serializeOfficialQqForumRichText("只提到 #800"),
          },
        }],
      });
    }) as typeof fetch;

    const result = await createOfficialQqForumThread({
      id: "bot-strict-batch",
      officialAppId: "10010",
      officialAppSecret: "strict-batch-secret",
    }, "forum-channel", {
      title: "#800 等 2 条稿件",
      content: "批量正文",
      matchDisplayIds: [800, 801],
    });

    expect(methods).toEqual(["GET", "PUT"]);
    expect(result.threadId).toBe("thread-new-batch");
  });

  it("撤回补偿查询也能只按稿件 ID 从帖子列表找到帖子 ID", async () => {
    const requests: Array<{ url: string; init: RequestInit | BunFetchRequestInit | undefined }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "recall-list-token", expires_in: 7200 });
      }
      return Response.json({
        threads: [{
          thread_info: {
            thread_id: "thread-6962-recall",
            title: "#6962",
            content: serializeOfficialQqForumRichText("历史帖子"),
          },
        }],
        is_finish: 1,
      });
    }) as typeof fetch;

    await expect(findOfficialQqForumThreadIdByDisplayIds({
      id: "bot-recall-list",
      officialAppId: "10007",
      officialAppSecret: "recall-list-secret",
    }, "forum-channel", [6962])).resolves.toBe("thread-6962-recall");

    expect(requests.map((request) => request.url)).toEqual([
      "https://bots.qq.com/app/getAppAccessToken",
      "https://api.sgroup.qq.com/channels/forum-channel/threads",
    ]);
    expect(requests[1]?.init?.method).toBe("GET");
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


  it("调用删除帖子接口撤回指定论坛帖", async () => {
    const requests: Array<{ url: string; init: RequestInit | BunFetchRequestInit | undefined }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://bots.qq.com/app/getAppAccessToken") {
        return Response.json({ access_token: "delete-token", expires_in: 7200 });
      }
      return new Response("", { status: 204 });
    }) as typeof fetch;

    await expect(deleteOfficialQqForumThread({
      id: "bot-delete",
      officialAppId: "10004",
      officialAppSecret: "delete-secret",
    }, " selected/channel ", " thread/1 ")).resolves.toBeNull();

    const deleteRequest = requests.find((request) => request.url.startsWith("https://api.sgroup.qq.com/"));
    expect(deleteRequest?.url).toBe("https://api.sgroup.qq.com/channels/selected%2Fchannel/threads/thread%2F1");
    expect(deleteRequest?.init?.method).toBe("DELETE");
    expect(deleteRequest?.init?.body).toBeUndefined();
    expect(new Headers(deleteRequest?.init?.headers).get("Authorization")).toBe("QQBot delete-token");
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