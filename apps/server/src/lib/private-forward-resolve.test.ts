import { describe, expect, test } from "bun:test";
import {
  findForwardMessageId,
  parsePrivateForwardHeader,
  readForwardNodeIdentity,
  readForwardNodes,
  readMessageSenderQq,
  readSegmentText,
} from "./private-forward-resolve";

describe("readForwardNodeIdentity", () => {
  test("我们发送时使用的平铺写法", () => {
    expect(readForwardNodeIdentity({
      type: "node",
      data: { name: "小明", nickname: "小明", uin: "123456789", user_id: "123456789", qq: "123456789" },
    })).toEqual({ qqUin: "123456789", nickname: "小明" });
  });

  test("协议端回包常见的 sender 对象", () => {
    expect(readForwardNodeIdentity({
      type: "node",
      data: { content: [] },
      sender: { user_id: 987654321, nickname: "小红" },
    })).toEqual({ qqUin: "987654321", nickname: "小红" });
  });

  test("数字型 QQ 会被规范化成字符串", () => {
    expect(readForwardNodeIdentity({ data: { user_id: 53823552, name: "阿包" } })).toEqual({
      qqUin: "53823552",
      nickname: "阿包",
    });
  });

  test("缺昵称时回退成 QQ 号", () => {
    expect(readForwardNodeIdentity({ data: { qq: "3517150782" } })).toEqual({
      qqUin: "3517150782",
      nickname: "3517150782",
    });
  });

  test("没有 QQ 号时返回 null", () => {
    expect(readForwardNodeIdentity({ data: { nickname: "匿名" } })).toBeNull();
    expect(readForwardNodeIdentity(null)).toBeNull();
    expect(readForwardNodeIdentity("x")).toBeNull();
  });
});

describe("readForwardNodes", () => {
  test("messages 字段", () => {
    expect(readForwardNodes({ messages: [{}, {}] })).toHaveLength(2);
  });

  test("message / content 字段", () => {
    expect(readForwardNodes({ message: [{}] })).toHaveLength(1);
    expect(readForwardNodes({ content: [{}] })).toHaveLength(1);
  });

  test("非数组或缺失返回空数组", () => {
    expect(readForwardNodes({})).toEqual([]);
    expect(readForwardNodes(null)).toEqual([]);
  });
});

describe("findForwardMessageId", () => {
  test("forward 段取 id", () => {
    expect(findForwardMessageId([
      { type: "text", data: { text: "hi" } },
      { type: "forward", data: { id: "748352241819" } },
    ])).toBe("748352241819");
  });

  test("数字 id 转字符串", () => {
    expect(findForwardMessageId([{ type: "forward", data: { id: 12345 } }])).toBe("12345");
  });

  test("兼容 res_id / message_id 与 node 段", () => {
    expect(findForwardMessageId([{ type: "forward", data: { res_id: "777" } }])).toBe("777");
    expect(findForwardMessageId([{ type: "node", data: { message_id: "888" } }])).toBe("888");
  });

  test("CQ 字符串形态也能取到 forward id", () => {
    expect(findForwardMessageId("[CQ:forward,id=748352241819]")).toBe("748352241819");
    expect(findForwardMessageId("[CQ:reply,id=1][CQ:forward,id=777]")).toBe("777");
  });

  test("没有聊天记录段时返回 null", () => {
    expect(findForwardMessageId([{ type: "text", data: { text: "x" } }])).toBeNull();
    expect(findForwardMessageId("普通文本消息")).toBeNull();
    expect(findForwardMessageId("[CQ:image,file=abc.jpg]")).toBeNull();
    expect(findForwardMessageId(null)).toBeNull();
  });
});

describe("readSegmentText", () => {
  test("拼接文本段并忽略 reply / at", () => {
    expect(readSegmentText([
      { type: "reply", data: { id: "1" } },
      { type: "at", data: { qq: "2" } },
      { type: "text", data: { text: "你好" } },
      { type: "text", data: { text: "世界" } },
    ])).toBe("你好世界");
  });

  test("直接传字符串原样返回", () => {
    expect(readSegmentText("纯文本")).toBe("纯文本");
  });

  test("非法输入返回空串", () => {
    expect(readSegmentText(null)).toBe("");
  });
});

describe("parsePrivateForwardHeader", () => {
  test("新格式：QQ 前置，昵称不参与解析", () => {
    expect(parsePrivateForwardHeader("📩 [QQ 53823552] 小明 发来私聊消息：\n\n1. 你好")).toEqual({
      qqUin: "53823552",
      nickname: "小明",
    });
  });

  test("新格式：昵称里带 [QQ xxx] 也不会被误解析", () => {
    expect(parsePrivateForwardHeader("📩 [QQ 123456789] 小明[QQ 999999] 发来私聊消息：在吗")).toEqual({
      qqUin: "123456789",
      nickname: "小明[QQ 999999]",
    });
  });

  test("旧格式：昵称伪造身份令牌时取最后一段（真实 QQ 由程序追加在末尾）", () => {
    expect(parsePrivateForwardHeader("📩 小明（99999999）发来私聊消息：（123456789）发来私聊消息：hi")).toEqual({
      qqUin: "123456789",
      nickname: "小明（99999999）发来私聊消息：",
    });
  });

  test("解析降级消息的头部", () => {
    expect(parsePrivateForwardHeader("📩 小明（53823552）发来私聊消息：\n\n1. 你好")).toEqual({
      qqUin: "53823552",
      nickname: "小明",
    });
  });

  test("昵称里带括号也能解析", () => {
    expect(parsePrivateForwardHeader("📩 阿包（高一二班）（123456789）发来私聊消息：在吗")).toEqual({
      qqUin: "123456789",
      nickname: "阿包（高一二班）",
    });
  });

  test("非头部文本返回 null", () => {
    expect(parsePrivateForwardHeader("普通群消息")).toBeNull();
    expect(parsePrivateForwardHeader("")).toBeNull();
  });
});

describe("readMessageSenderQq", () => {
  test("sender.user_id", () => {
    expect(readMessageSenderQq({ sender: { user_id: 459447320 } })).toBe("459447320");
  });

  test("user.uin 兼容", () => {
    expect(readMessageSenderQq({ user: { uin: "123456789" } })).toBe("123456789");
  });

  test("缺失返回 null", () => {
    expect(readMessageSenderQq({})).toBeNull();
    expect(readMessageSenderQq(null)).toBeNull();
  });
});
