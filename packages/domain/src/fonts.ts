import { z } from "zod";

export const postFontSchema = z.enum([
  "default",
  "beinidekeaitianyunle",
  "dunhuangfeitiankai",
  "mengxiangchaoyanningti",
  "unifontdianzhenhei",
  "zhuoteqingyati",
  "zihuisongkexietiw4",
]);
export type PostFont = z.infer<typeof postFontSchema>;

export const postFontDefault = "default";

export const FONT_OPTIONS: Array<{ value: PostFont; label: string; fileName: string }> = [
  { value: postFontDefault, label: "默认字体", fileName: "" },
  { value: "beinidekeaitianyunle", label: "贝尼的可爱云乐体", fileName: "beinidekeaitianyunle.ttf" },
  { value: "dunhuangfeitiankai", label: "敦煌飞天楷", fileName: "dunhuangfeitiankai.ttf" },
  { value: "mengxiangchaoyanningti", label: "梦想超妍宁体", fileName: "mengxiangchaoyanningti.ttf" },
  { value: "unifontdianzhenhei", label: "点阵黑体", fileName: "unifontdianzhenhei.ttf" },
  { value: "zhuoteqingyati", label: "卓特清雅体", fileName: "zhuoteqingyati.ttf" },
  { value: "zihuisongkexietiw4", label: "字汇宋克斜体", fileName: "zihuisongkexietiw4.ttf" },
];

export const FONT_FILE_MAP: Record<string, string> = Object.fromEntries(
  FONT_OPTIONS.filter((f) => f.value !== postFontDefault).map((f) => [f.value, f.fileName]),
);

export function isDefaultFont(font: string | null | undefined): boolean {
  return !font || font === postFontDefault;
}
