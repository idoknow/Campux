import { describe, expect, test } from "bun:test";
import {
  pbVarint,
  pbFieldVarint,
  pbFieldBytes,
  buildShortPostPatternInfo,
  buildLongPostPatternInfo,
  PERSONAL_QQ_MAX_IMAGE_BYTES,
} from "./personal-qq";
import type { PersonalQqUploadedImage } from "./personal-qq";

describe("pbVarint / pbField 编码（对照已验证抓包的 sliceupload 字节）", () => {
  test("pbVarint 小值", () => {
    expect([...pbVarint(2)]).toEqual([0x02]);
    expect([...pbVarint(1)]).toEqual([0x01]);
  });
  test("pbFieldVarint(field, value) 生成 tag+varint", () => {
    // field 1, value 2 => tag=(1<<3)|0=0x08, 值 0x02
    expect([...pbFieldVarint(1, 2)]).toEqual([0x08, 0x02]);
    // field 2, value 1487 => tag=(2<<3)|0=0x10, 值 1487 varint
    expect([...pbFieldVarint(2, 1487)]).toEqual([0x10, 0xcf, 0x0b]);
    // field 3, value 1 => tag=0x18, 值 0x01
    expect([...pbFieldVarint(3, 1)]).toEqual([0x18, 0x01]);
  });
  test("pbFieldBytes(field, data) 生成 tag+len+data", () => {
    // field 1, "0" => tag=(1<<3)|2=0x0a, len=1, '0'=0x30
    expect([...pbFieldBytes(1, Buffer.from("0"))]).toEqual([0x0a, 0x01, 0x30]);
    // field 107 len-delimited 用在最外层（tag=(107<<3)|2 的 varint）
    const f107 = pbFieldBytes(107, Buffer.from([0x08]));
    // tag=107<<3|2 = 858 => varint [0xda, 0x06]；len=1；data 0x08
    expect([...f107]).toEqual([0xda, 0x06, 0x01, 0x08]);
  });
  test("PERSONAL_QQ_MAX_IMAGE_BYTES 为 5MB", () => {
    expect(PERSONAL_QQ_MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});

const uploaded: PersonalQqUploadedImage = {
  fileUuid: "EhTestFileUuid1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO",
  picUrl: "https://channelr.photo.store.qq.com/psc?test=1",
  width: 400,
  height: 200,
  md5: "abcd1234",
  origSize: 12345,
};

describe("buildLongPostPatternInfo 长贴富文本", () => {
  test("无图时只含标题/正文 blockParagraph", () => {
    const info = buildLongPostPatternInfo("标题", "正文", []);
    const arr = JSON.parse(info);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(2);
    expect(arr[1].data[0].text).toBe("正文");
  });
  test("带图时将 type:6 图片节点内联到正文 data，fileId/id/taskId 用 fileUuid", () => {
    const info = buildLongPostPatternInfo("标题", "正文", [uploaded]);
    const arr = JSON.parse(info);
    expect(arr.length).toBe(2);
    const data = arr[1].data;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    const node = data[1];
    expect(node.type).toBe(6);
    expect(node.fileId).toBe(uploaded.fileUuid);
    expect(node.id).toBe(uploaded.fileUuid);
    expect(node.taskId).toBe(uploaded.fileUuid);
    expect(node.url).toBe(uploaded.picUrl);
    expect(node.isInline).toBe(true);
    expect(node.widthPercentage).toBe(100);
  });
});

describe("buildShortPostPatternInfo 短贴富文本", () => {
  test("带图时 nodes 数组含 type:6 图片节点", () => {
    const info = buildShortPostPatternInfo("正文", [uploaded]);
    const arr = JSON.parse(info);
    expect(Array.isArray(arr)).toBe(true);
    const imageNodes = JSON.stringify(arr).includes('"type":6');
    expect(imageNodes).toBe(true);
    expect(JSON.stringify(arr)).toContain(uploaded.fileUuid);
  });
});