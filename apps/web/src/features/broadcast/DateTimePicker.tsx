import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClockIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const MAX_DAYS = 7;

type BroadcastPreset = { label: string; minutes: number };

/** 将预设的分钟偏移量折算成目标时刻；超过 7 天上限则取上限。 */
function resolvePreset(preset: BroadcastPreset, now: Date, max: Date) {
  const candidate = new Date(now.getTime() + preset.minutes * 60 * 1000);
  return candidate.getTime() > max.getTime() ? new Date(max.getTime()) : candidate;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 数字取数器：鼠标滚轮增减，也可直接输入数字。
 * React 把 wheel 监听注册为 passive，无法 preventDefault，
 * 因此这里用原生非 passive 监听，避免滚轮同时滚动页面。
 */
function NumberSpinner({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean | undefined;
  onChange: (next: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => pad2(value));
  const [focused, setFocused] = useState(false);

  // 用 ref 保存最新属性，原生 wheel 监听只需挂一次。
  const stateRef = useRef({ value, min, max, step, onChange });
  stateRef.current = { value, min, max, step, onChange };

  function apply(next: number) {
    const current = stateRef.current;
    const clamped = clamp(next, current.min, current.max);
    setText(pad2(clamped));
    if (clamped !== current.value) current.onChange(clamped);
  }

  // 未聚焦时跟随外部值；聚焦时不覆盖用户正在输入的内容。
  useEffect(() => {
    if (!focused) setText(pad2(value));
  }, [value, focused]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = stateRef.current;
      apply(current.value + (event.deltaY < 0 ? current.step : -current.step));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  function commit(raw: string) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setText(pad2(value));
      return;
    }
    apply(parsed);
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-md border border-slate-200 bg-white p-0.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply(value - step)}
          className="grid size-8 place-items-center rounded text-lg leading-none text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
          aria-label={`${label}减一`}
        >
          −
        </button>
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={text}
          disabled={disabled}
          onFocus={(event) => {
            setFocused(true);
            event.target.select();
          }}
          onBlur={(event) => {
            setFocused(false);
            commit(event.target.value);
          }}
          onChange={(event) => {
            const raw = event.target.value;
            setText(raw);
            // 两位及以上（如 "07"、"59"）即时生效；单位数字等失焦时再归一化。
            const parsed = Number.parseInt(raw, 10);
            if (raw.length >= 2 && Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit((event.target as HTMLInputElement).value);
            if (event.key === "ArrowUp") {
              event.preventDefault();
              apply(value + step);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              apply(value - step);
            }
          }}
          className="w-12 border-0 bg-transparent text-center text-lg font-semibold tabular-nums text-slate-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply(value + step)}
          className="grid size-8 place-items-center rounded text-lg leading-none text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
          aria-label={`${label}加一`}
        >
          +
        </button>
      </div>
      <span className="text-sm font-medium text-slate-500">{label}</span>
    </div>
  );
}

function dayLabel(date: Date, now: Date) {
  if (isSameDay(date, now)) return "今天";
  if (isSameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return "明天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDisplay(value: Date | null, now: Date) {
  return value ? `${dayLabel(value, now)} ${pad2(value.getHours())}:${pad2(value.getMinutes())}` : "点击选择";
}

type DateTimePickerProps = {
  /** 选中的结束时间；null 表示尚未选择 */
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** 管理员在插件配置里下发的快选生效时长，最多 5 个 */
  presets: BroadcastPreset[];
  label?: string;
  hint?: string;
  disabled?: boolean;
};

/**
 * 自绘的分步时间选择弹窗：先选日期，再选小时，最后选分钟。
 * 预设快选时长由插件配置下发，不再在此处硬编码。
 */
export function DateTimePicker({
  value,
  onChange,
  presets,
  label = "时效结束时间",
  hint,
  disabled,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);
  const [view, setView] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() });
  const [step, setStep] = useState(0);

  // 打开弹窗时按「当前时刻」重新起算，保证 7 天上限与预设偏移始终相对现在。
  const now = useMemo(() => new Date(), [open]);
  const min = useMemo(() => startOfDay(now), [now]);
  const max = useMemo(() => new Date(min.getTime() + MAX_DAYS * 86_400_000), [min]);
  const activePresets = useMemo(() => presets.slice(0, 5), [presets]);

  useEffect(() => {
    if (!open) return;
    // 未选过时给一个可提交的默认值（1 小时后），避免刚打开就处于不可提交状态。
    const anchor = value ?? new Date(now.getTime() + 60 * 60 * 1000);
    setDraft(anchor);
    setView({ year: anchor.getFullYear(), month: anchor.getMonth() });
    setStep(value ? 1 : 0);
  }, [open]);

  const cells = useMemo(() => {
    const blanks = Array.from({ length: new Date(view.year, view.month, 1).getDay() }, () => null as Date | null);
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const days: Array<Date | null> = [...blanks];
    for (let day = 1; day <= daysInMonth; day += 1) days.push(new Date(view.year, view.month, day));
    while (days.length % 7 !== 0) days.push(null);
    return days.map((date) => {
      if (!date) return null;
      return {
        date,
        disabled: date < min || startOfDay(date) > startOfDay(max),
        today: isSameDay(date, now),
        selected: !!draft && isSameDay(date, draft),
      };
    });
  }, [view.year, view.month, draft, min, max, now]);

  const hour = draft?.getHours() ?? 18;
  const minute = draft?.getMinutes() ?? 0;

  function commit(next: Date | null) {
    if (next) {
      onChange(next);
      setOpen(false);
    }
  }

  function pickDate(day: Date) {
    setDraft(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute));
    setStep(1);
  }

  function setHour(next: number) {
    if (!draft) return;
    setDraft(new Date(draft.getFullYear(), draft.getMonth(), draft.getDate(), next, minute));
  }

  function setMinute(next: number) {
    if (!draft) return;
    setDraft(new Date(draft.getFullYear(), draft.getMonth(), draft.getDate(), draft.getHours(), next));
  }

  function moveMonth(delta: number) {
    const next = new Date(view.year, view.month + delta, 1);
    if (startOfDay(next) < min || startOfDay(next) > startOfDay(max)) return;
    setView({ year: next.getFullYear(), month: next.getMonth() });
  }

  function goBack() {
    if (step === 0) {
      setOpen(false);
      return;
    }
    setStep((previous) => previous - 1);
  }

  function canApply(target: Date) {
    return target.getTime() > now.getTime() && target.getTime() <= max.getTime();
  }

  const canConfirm = !!draft && canApply(draft);

  return (
    <div className="w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-amber-300 hover:bg-amber-50/50",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-700">{label}</span>
          {hint ? <span className="block text-xs font-normal text-slate-400">{hint}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-slate-800">
          {value ? <span>{formatDisplay(value, now)}</span> : <span className="text-slate-400">点击选择</span>}
          {!disabled ? <CalendarClockIcon className="size-4 text-slate-400" /> : null}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden">
          <DialogHeader className="shrink-0 border-b">
            <DialogTitle>选择结束时间</DialogTitle>
            <DialogDescription>先选日期，再选小时，最后选分钟；最长 7 天。</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-900">
                {dayLabel(draft ?? now, now)} {pad2(hour)}:{pad2(minute)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                <span className={cn("size-1.5 rounded-full", canConfirm ? "bg-emerald-500" : "bg-slate-300")} />
                第 {step + 1} 步
              </span>
            </div>

            <div className="mt-3">
              {step === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => moveMonth(-1)}
                      className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100"
                      aria-label="上个月"
                    >
                      <ChevronLeftIcon className="size-4" />
                    </button>
                    <span className="text-sm font-semibold text-slate-900">
                      {view.year} 年 {view.month + 1} 月
                    </span>
                    <button
                      type="button"
                      onClick={() => moveMonth(1)}
                      className="grid size-7 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100"
                      aria-label="下个月"
                    >
                      <ChevronRightIcon className="size-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {WEEKDAYS.map((weekday) => (
                      <span key={weekday} className="pb-1 text-xs text-slate-400">
                        {weekday}
                      </span>
                    ))}
                    {cells.map((cell, index) =>
                      cell ? (
                        <button
                          key={cell.date.toISOString()}
                          type="button"
                          disabled={cell.disabled}
                          onClick={() => pickDate(cell.date)}
                          className={cn(
                            "grid h-7 place-items-center rounded-md text-xs transition",
                            cell.disabled && "text-slate-300",
                            !cell.disabled && !cell.selected && "text-slate-700 hover:bg-amber-100",
                            cell.today && "font-bold text-amber-600",
                            cell.selected && "bg-amber-500 font-semibold text-white hover:bg-amber-500",
                          )}
                        >
                          {cell.date.getDate()}
                        </button>
                      ) : (
                        <span key={`blank-${index}`} className="h-7" />
                      ),
                    )}
                  </div>
                </div>
              ) : null}

              {step === 1 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="mb-3 text-xs text-slate-500">滚动鼠标滚轮增减，或直接输入数字。</p>
                  <div className="flex justify-center">
                    <NumberSpinner label="小时" value={hour} min={0} max={23} step={1} disabled={disabled} onChange={setHour} />
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="mb-3 text-xs text-slate-500">滚动鼠标滚轮增减，或直接输入数字。</p>
                  <div className="flex justify-center">
                    <NumberSpinner label="分钟" value={minute} min={0} max={59} step={1} disabled={disabled} onChange={setMinute} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="shrink-0 flex-wrap items-center gap-2 border-t px-5 py-3">
            {activePresets.length > 0 ? (
              <div className="mr-auto flex flex-wrap items-center gap-1.5">
                {activePresets.map((preset) => (
                  <Button
                    key={preset.label}
                    size="sm"
                    variant="outline"
                    className="bg-white"
                    disabled={disabled}
                    onClick={() => commit(resolvePreset(preset, now, max))}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <Button variant="ghost" onClick={goBack}>
              {step === 0 ? "取消" : "上一步"}
            </Button>
            <Button variant="ghost" onClick={() => { onChange(null); setOpen(false); }}>
              清空
            </Button>
            {step < 2 ? (
              <Button disabled={disabled} onClick={() => setStep((previous) => Math.min(2, previous + 1))}>
                下一步
              </Button>
            ) : (
              <Button disabled={!canConfirm || disabled} onClick={() => commit(draft)}>
                <CheckIcon className="size-3.5" />
                确定
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
