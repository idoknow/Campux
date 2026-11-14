import { describe, expect, test } from "bun:test";
import {
  disabledPresentationPluginGates,
  presentationPluginGatesFrom,
  stripDisabledPresentationFields,
  type PresentationPluginGates,
} from "./presentation-plugins";
import { defaultTenantPluginConfig } from "./tenant-plugin-config";

const allEnabled: PresentationPluginGates = {
  colorSelection: true,
  fontSelection: true,
  anonymousAvatar: true,
  heatBoard: true,
};

const filled = {
  anonymousAvatar: "1.svg",
  bgColor: "pink",
  textColor: "dark_red",
  font: "kaiti",
  pendingTagNames: ["期末", "考研"],
};

describe("presentation plugin gates", () => {
  test("从插件配置里取四个样式开关", () => {
    const gates = presentationPluginGatesFrom({
      ...defaultTenantPluginConfig,
      colorSelection: { ...defaultTenantPluginConfig.colorSelection, enabled: true },
      heatBoard: { ...defaultTenantPluginConfig.heatBoard, enabled: true },
    });

    expect(gates).toEqual({
      colorSelection: true,
      fontSelection: false,
      anonymousAvatar: false,
      heatBoard: true,
    });
  });

  test("全部开启时原样保留", () => {
    expect(stripDisabledPresentationFields(filled, allEnabled)).toEqual(filled);
  });

  test("全部关闭时丢弃样式与话题", () => {
    expect(stripDisabledPresentationFields(filled, disabledPresentationPluginGates)).toEqual({
      anonymousAvatar: null,
      bgColor: null,
      textColor: null,
      font: null,
      pendingTagNames: [],
    });
  });

  test("只关掉一个插件时只丢对应字段", () => {
    const fields = stripDisabledPresentationFields(filled, { ...allEnabled, fontSelection: false });

    expect(fields.font).toBeNull();
    expect(fields.bgColor).toBe("pink");
    expect(fields.pendingTagNames).toEqual(["期末", "考研"]);
  });

  test("不修改传入的字段对象", () => {
    const input = { ...filled, pendingTagNames: [...filled.pendingTagNames] };

    stripDisabledPresentationFields(input, disabledPresentationPluginGates);

    expect(input.anonymousAvatar).toBe("1.svg");
    expect(input.pendingTagNames).toEqual(["期末", "考研"]);
  });
});
