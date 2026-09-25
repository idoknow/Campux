import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// 常用学历快捷选项：点击填入输入框，仍可手动改写成任何具体学历（中专、职高、专升本等）。
const EDUCATION_PRESETS = ["初中", "高中", "大专", "本科", "硕士", "博士"] as const;

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

type Draft = {
  classYear: string;
  graduationYear: string;
  education: string;
  destination: string;
};

const EMPTY_DRAFT: Draft = { classYear: "", graduationYear: "", education: "", destination: "" };

function draftKey(tenantId: string) {
  return `campux.graduation.draft.${tenantId}`;
}

function readDraft(tenantId: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      classYear: typeof parsed.classYear === "string" ? parsed.classYear : "",
      graduationYear: typeof parsed.graduationYear === "string" ? parsed.graduationYear : "",
      education: typeof parsed.education === "string" ? parsed.education : "",
      destination: typeof parsed.destination === "string" ? parsed.destination : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(tenantId: string, draft: Draft) {
  try { window.localStorage.setItem(draftKey(tenantId), JSON.stringify(draft)); } catch { /* ignore */ }
}

function clearDraft(tenantId: string) {
  try { window.localStorage.removeItem(draftKey(tenantId)); } catch { /* ignore */ }
}

function clampYear(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(MIN_YEAR, Math.min(MAX_YEAR, Math.floor(value)));
}

export function GraduationCreateForm({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: () => void;
}) {
  const initial = useMemo(() => readDraft(tenantId), [tenantId]);
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  // 更新字段并写本地草稿
  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      writeDraft(tenantId, next);
      return next;
    });
  }

  async function submit() {
    const classYear = clampYear(Number(draft.classYear));
    const graduationYear = clampYear(Number(draft.graduationYear));
    if (!classYear) {
      toast.error("请填写入学年份（级）");
      return;
    }
    if (!graduationYear) {
      toast.error("请填写毕业年份（届）");
      return;
    }
    if (graduationYear < classYear) {
      toast.error("毕业年份（届）不能早于入学年份（级）");
      return;
    }
    if (!draft.education.trim()) {
      toast.error("请填写毕业时学历");
      return;
    }
    const destination = draft.destination.trim();
    if (destination.length < 2) {
      toast.error("请填写毕业去向（学校/单位全称）");
      return;
    }

    setBusy(true);
    try {
      await api("/api/graduations", {
        method: "POST",
        body: JSON.stringify({
          classYear,
          graduationYear,
          education: draft.education,
          destination,
        }),
      });
      clearDraft(tenantId);
      toast.success("毕业去向已提交审核");
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = clampYear(Number(draft.classYear)) > 0
    && clampYear(Number(draft.graduationYear)) > 0
    && Number(draft.graduationYear) >= Number(draft.classYear)
    && Boolean(draft.education.trim())
    && draft.destination.trim().length >= 2;

  return (
    <section className="product-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">填写毕业去向</h2>
          <p className="mt-1 text-sm leading-5 text-slate-500">
            入学年份（级）与毕业年份（届）都请自己填写。审核通过后进入服务页统计视图。
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs text-slate-500">入学年份（级）</span>
            <Input
              type="number"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={draft.classYear}
              placeholder="如 2021"
              onChange={(event) => patchDraft({ classYear: event.target.value })}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-slate-500">毕业年份（届）</span>
            <Input
              type="number"
              min={MIN_YEAR}
              max={MAX_YEAR}
              value={draft.graduationYear}
              placeholder="如 2025"
              onChange={(event) => patchDraft({ graduationYear: event.target.value })}
            />
          </label>
        </div>
        {draft.classYear && draft.graduationYear && Number(draft.graduationYear) < Number(draft.classYear) ? (
          <p className="text-xs text-rose-600">毕业年份（届）不能早于入学年份（级）。</p>
        ) : null}

        <div className="space-y-1.5">
          <label className="grid gap-1">
            <span className="text-xs text-slate-500">毕业时学历（如读高中毕业就是高中学历）</span>
            <Input
              value={draft.education}
              maxLength={20}
              placeholder="如：高中 / 本科 / 中专"
              onChange={(event) => patchDraft({ education: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {EDUCATION_PRESETS.map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded-full px-3 py-1.5 text-sm ${draft.education === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                onClick={() => patchDraft({ education: item })}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <label className="grid gap-1">
          <span className="text-xs text-slate-500">毕业去向（学校/单位全称）</span>
          <Input
            value={draft.destination}
            maxLength={120}
            placeholder="如：清华大学 计算机科学与技术学院"
            onChange={(event) => patchDraft({ destination: event.target.value })}
          />
        </label>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => { clearDraft(tenantId); setDraft(EMPTY_DRAFT); }}>
            清空
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !canSubmit}>
            {busy ? "提交中..." : "提交审核"}
          </Button>
        </div>
      </div>
    </section>
  );
}
