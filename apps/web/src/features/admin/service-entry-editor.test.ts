import { describe, expect, it } from "bun:test";
import {
  createEmptyServiceEntryDraft,
  getBuiltInServiceEntryAction,
  moveServiceEntryDraft,
  prepareServiceEntriesForSave,
  toCustomServiceEntryDrafts,
} from "../../lib/service-entry-editor";

describe("service entry editor", () => {
  it("turns configured custom services into complete visual editor drafts", () => {
    expect(toCustomServiceEntryDrafts([
      { title: "修改名称", description: "内置入口" },
      { title: "修改密码", description: "内置入口" },
      { title: "投稿规则", description: "内置入口" },
      { title: "校园地图", description: "查看教学楼", url: "https://map.example.com" },
      { title: "校历" },
      { title: "新生指南", url: "https://guide.example.com" },
    ])).toEqual([
      { title: "校园地图", description: "查看教学楼", url: "https://map.example.com" },
      { title: "校历", description: "", url: "" },
      { title: "新生指南", description: "", url: "https://guide.example.com" },
    ]);
  });

  it("creates an empty draft for the add-entry action", () => {
    expect(createEmptyServiceEntryDraft()).toEqual({ title: "", description: "", url: "" });
  });

  it("moves an entry without mutating the current draft list", () => {
    const current = [
      { title: "A", description: "", url: "" },
      { title: "B", description: "", url: "" },
      { title: "C", description: "", url: "" },
    ];

    expect(moveServiceEntryDraft(current, 0, 2).map((entry) => entry.title)).toEqual(["B", "C", "A"]);
    expect(current.map((entry) => entry.title)).toEqual(["A", "B", "C"]);
    expect(moveServiceEntryDraft(current, -1, 1)).toBe(current);
    expect(moveServiceEntryDraft(current, 1, 3)).toBe(current);
  });

  it("trims visual fields and omits empty optional values before saving", () => {
    expect(prepareServiceEntriesForSave([
      { title: " 校园地图 ", description: " 查看教学楼 ", url: " https://map.example.com " },
      { title: " 校历 ", description: "   ", url: "" },
    ])).toEqual([
      { title: "校园地图", description: "查看教学楼", url: "https://map.example.com" },
      { title: "校历" },
    ]);
  });

  it("rejects an entry without a title with a field-specific message", () => {
    expect(() => prepareServiceEntriesForSave([
      { title: " ", description: "说明", url: "" },
    ])).toThrow("第 1 个服务入口缺少名称");
  });

  it("rejects custom entries that reuse a fixed account-entry title", () => {
    expect(() => prepareServiceEntriesForSave([
      { title: "修改密码", description: "重复的固定入口", url: "https://example.com" },
    ])).toThrow("第 1 个服务入口使用了固定账户入口名称");
  });

  it("rejects non-HTTP service links", () => {
    expect(() => prepareServiceEntriesForSave([
      { title: "危险链接", description: "", url: "javascript:alert(1)" },
    ])).toThrow("第 1 个服务入口的跳转链接必须使用 http 或 https");
  });

  it("resolves actions only for exact fixed-entry titles", () => {
    expect(getBuiltInServiceEntryAction({ title: "修改名称" })).toBe("profile");
    expect(getBuiltInServiceEntryAction({ title: "修改密码" })).toBe("password");
    expect(getBuiltInServiceEntryAction({ title: "投稿规则" })).toBe("rules");
    expect(getBuiltInServiceEntryAction({ title: "新生指南" })).toBeNull();
    expect(getBuiltInServiceEntryAction({ title: "密码重置文档" })).toBeNull();
  });
});
