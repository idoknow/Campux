import { z } from "zod";

export const postFontSchema = z.enum([
  "default",
  "beishidajiaguwenziti1",
  "chengmingshouxieti",
  "hanchanhuokaiti",
  "lipinhuiziyouluoti",
  "yishanbeizhuanti",
  "cascadianextjianti",
  "hanchanbanyuanti",
  "hongmengsansscmediumziti",
  "linhailishu",
  "namidiansong",
  "siyuanyuanti",
  "zhouzisongti",
]);
export type PostFont = z.infer<typeof postFontSchema>;

export const postFontDefault = "default";

export const FONT_OPTIONS: Array<{ value: PostFont; label: string; fileName: string }> = [
  { value: postFontDefault, label: "默认字体", fileName: "" },
  { value: "beishidajiaguwenziti1", label: "甲骨文字体", fileName: "BeiShiDaJiaGuWenZiTi-1.ttf" },
  { value: "chengmingshouxieti", label: "承明手写体", fileName: "chengmingshouxieti.ttf" },
  { value: "hanchanhuokaiti", label: "寒蝉活楷体", fileName: "hanchanhuokaiti.otf" },
  { value: "lipinhuiziyouluoti", label: "礼品会自由落体", fileName: "lipinhuiziyouluoti.ttf" },
  { value: "yishanbeizhuanti", label: "逸善碑篆体", fileName: "yishanbeizhuanti.ttf" },
  { value: "cascadianextjianti", label: "Cascadia Next 简体", fileName: "cascadianextjianti.ttf" },
  { value: "hanchanbanyuanti", label: "寒蝉半圆体", fileName: "hanchanbanyuanti.ttf" },
  { value: "hongmengsansscmediumziti", label: "鸿蒙 Sans SC Medium", fileName: "hongmengsansscmediumziti.ttf" },
  { value: "linhailishu", label: "临海隶书", fileName: "linhailishu.ttf" },
  { value: "namidiansong", label: "纳米点宋", fileName: "namidiansong.ttf" },
  { value: "siyuanyuanti", label: "思源圆体", fileName: "siyuanyuanti.ttf" },
  { value: "zhouzisongti", label: "舟字宋体", fileName: "zhouzisongti.otf" },
];

export const FONT_FILE_MAP: Record<string, string> = Object.fromEntries(
  FONT_OPTIONS.filter((f) => f.value !== postFontDefault).map((f) => [f.value, f.fileName]),
);

export function isDefaultFont(font: string | null | undefined): boolean {
  return !font || font === postFontDefault;
}
