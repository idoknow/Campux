import { describe, expect, test } from "bun:test";
import { extractOneBotImageSegments, extractOneBotPlainText, isPrivatePostCancelText, isPrivatePostFinishText, parsePrivatePostModeText, parsePrivatePostStartText, parsePrivatePostImageDecisionText } from "./private-posting";

describe("private posting command parsing", () => {
  test("parses English hash start command", () => {
    expect(parsePrivatePostStartText("#投稿 你好，世界")).toBe("你好，世界");
  });

  test("parses Chinese hash start command", () => {
    expect(parsePrivatePostStartText("＃投稿 你好，世界")).toBe("你好，世界");
  });

  test("accepts start command without a body", () => {
    expect(parsePrivatePostStartText("#投稿")).toBe("");
  });

  test("detects finish command with either hash", () => {
    expect(isPrivatePostFinishText("#结束投稿")).toBe(true);
    expect(isPrivatePostFinishText("＃结束投稿")).toBe(true);
    expect(isPrivatePostFinishText("#结束投稿  ")).toBe(true);
  });

  test("detects cancel command with either hash", () => {
    expect(isPrivatePostCancelText("#取消投稿")).toBe(true);
    expect(isPrivatePostCancelText("＃取消投稿")).toBe(true);
  });

  test("detects anonymous and real-name replies", () => {
    expect(parsePrivatePostModeText("#匿名")).toEqual({ anonymous: true });
    expect(parsePrivatePostModeText("＃匿名投稿")).toEqual({ anonymous: true });
    expect(parsePrivatePostModeText("#实名")).toEqual({ anonymous: false });
    expect(parsePrivatePostModeText("＃实名投稿")).toEqual({ anonymous: false });
  });

  test("detects add-image and no-image replies", () => {
    expect(parsePrivatePostImageDecisionText("#添加图片")).toEqual({ addImages: true });
    expect(parsePrivatePostImageDecisionText("＃要图片")).toEqual({ addImages: true });
    expect(parsePrivatePostImageDecisionText("#是")).toEqual({ addImages: true });
    expect(parsePrivatePostImageDecisionText("#不添加图片")).toEqual({ addImages: false });
    expect(parsePrivatePostImageDecisionText("＃不要图")).toEqual({ addImages: false });
    expect(parsePrivatePostImageDecisionText("#否")).toEqual({ addImages: false });
  });
});

describe("onebot message helpers", () => {
  test("extracts plain text from onebot segments", () => {
    expect(
      extractOneBotPlainText([
        { type: "text", data: { text: "#投稿 " } },
        { type: "image", data: { file: "base64://abc" } },
        { type: "text", data: { text: "正文" } },
      ]),
    ).toBe("#投稿 \n正文");
  });

  test("extracts image segments only", () => {
    expect(
      extractOneBotImageSegments([
        { type: "text", data: { text: "hello" } },
        { type: "image", data: { file: "base64://abc" } },
        { type: "image", data: { url: "https://example.com/a.png" } },
      ]),
    ).toHaveLength(2);
  });
});
