import type { TenantPluginConfig } from "./tenant-plugin-config";

/**
 * 投稿样式类预设插件的服务端门禁。
 *
 * 背景色、文字色、字体、匿名头像与话题各自对应一个预设插件。这些开关过去只在 web 端
 * 生效（关闭后隐藏选项），服务端仍然照收这些表单字段：旧草稿、缓存的前端包或者构造的
 * 请求都能把已经关闭的效果带进新稿件，看起来就像"插件已经关了还在生效"。这里把开关
 * 收敛成服务端可判定的 gates，投稿入口在落库前统一剥离。
 */
export type PresentationPluginGates = {
  colorSelection: boolean;
  fontSelection: boolean;
  anonymousAvatar: boolean;
  heatBoard: boolean;
};

/** 读不到插件配置时的兜底：全部按关闭处理（fail-closed）。 */
export const disabledPresentationPluginGates: PresentationPluginGates = {
  colorSelection: false,
  fontSelection: false,
  anonymousAvatar: false,
  heatBoard: false,
};

export function presentationPluginGatesFrom(config: TenantPluginConfig): PresentationPluginGates {
  return {
    colorSelection: config.colorSelection.enabled,
    fontSelection: config.fontSelection.enabled,
    anonymousAvatar: config.anonymousAvatar.enabled,
    heatBoard: config.heatBoard.enabled,
  };
}

export type PresentationFieldValues = {
  anonymousAvatar: string | null;
  bgColor: string | null;
  textColor: string | null;
  font: string | null;
  pendingTagNames: string[];
};

/**
 * 按 gates 丢弃对应插件已关闭的字段，返回新的字段对象（不修改入参）。
 */
export function stripDisabledPresentationFields(
  fields: PresentationFieldValues,
  gates: PresentationPluginGates,
): PresentationFieldValues {
  return {
    anonymousAvatar: gates.anonymousAvatar ? fields.anonymousAvatar : null,
    bgColor: gates.colorSelection ? fields.bgColor : null,
    textColor: gates.colorSelection ? fields.textColor : null,
    font: gates.fontSelection ? fields.font : null,
    pendingTagNames: gates.heatBoard ? fields.pendingTagNames : [],
  };
}
