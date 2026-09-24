import { useEffect, useMemo, useRef, useState } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { BroadcastItem, TenantMetadata } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "./DateTimePicker";

const MAX_CONTENT_LENGTH = 500;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type BroadcastDraft = {
  content: string;
  endsAt: string;
};

function draftKey(tenantId: string) {
  return `campux.broadcast.draft.${tenantId}`;
}

function readDraft(tenantId: string): BroadcastDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BroadcastDraft>;
    return {
      content: typeof parsed.content === "string" ? parsed.content : "",
      endsAt: typeof parsed.endsAt === "string" ? parsed.endsAt : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(tenantId: string, draft: BroadcastDraft) {
  try {
    window.localStorage.setItem(draftKey(tenantId), JSON.stringify(draft));
  } catch {
    // 本地存储不可用时静默放弃，不影响发布。
  }
}

function clearDraft(tenantId: string) {
  try {
    window.localStorage.removeItem(draftKey(tenantId));
  } catch {
    // 忽略
  }
}

function hasDraft(tenantId: string) {
  try {
    const raw = window.localStorage.getItem(draftKey(tenantId));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<BroadcastDraft>;
    return !!(parsed.content?.trim() || parsed.endsAt);
  } catch {
    return false;
  }
}

// 草稿按本地时区字符串存储，服务端按 UTC 解析，因此按本地时间组装。
function toLocalDateTimeValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function readEndsAt(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function BroadcastCreateForm({
  tenantId,
  metadata,
  onSuccess,
}: {
  tenantId: string;
  metadata: TenantMetadata;
  onSuccess: () => void;
}) {
  const initial = useMemo(() => readDraft(tenantId), [tenantId]);
  const [content, setContent] = useState(initial?.content ?? "");
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? "");
  const [busy, setBusy] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 草稿按租户隔离，切换校园墙时重新读取。
  useEffect(() => {
    const restored = readDraft(tenantId);
    setContent(restored?.content ?? "");
    setEndsAt(restored?.endsAt ?? "");
    return undefined;
  }, [tenantId]);

  // 跟随投稿页的草稿行为：输入时自动暂存到浏览器本地，切换租户时重新读取。
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      writeDraft(tenantId, { content, endsAt });
      setDraftSaved(hasDraft(tenantId));
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tenantId, content, endsAt]);

  async function publish() {
    const trimmed = content.trim();
    if (trimmed.length < 2) {
      toast.error("通知内容至少 2 个字");
      return;
    }
    if (!endsAt) {
      toast.error("请选择通知结束时间");
      return;
    }
    const endsAtDate = readEndsAt(endsAt);
    if (!endsAtDate) {
      toast.error("结束时间格式无效");
      return;
    }
    if (endsAtDate.getTime() <= Date.now()) {
      toast.error("结束时间必须晚于当前时间");
      return;
    }
    if (endsAtDate.getTime() > Date.now() + MAX_TTL_MS) {
      toast.error("通知时效不能超过 7 天");
      return;
    }

    setBusy(true);
    try {
      await api<BroadcastItem>("/api/broadcasts", {
        method: "POST",
        body: JSON.stringify({ content: trimmed, endsAt: endsAtDate.toISOString() }),
      });
      clearDraft(tenantId);
      setContent("");
      setEndsAt("");
      setDraftSaved(false);
      toast.success("广播通知已发布");
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">广播通知</h2>
          <p className="mt-1 text-sm leading-5 text-slate-500">向全校广播一条有时效的通知，最长 7 天。广播员可在服务页点击「已广播」登记。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {content.length}/{MAX_CONTENT_LENGTH}
          {draftSaved ? <span className="ml-1.5 font-normal text-slate-400">已自动保存草稿</span> : null}
        </span>
      </div>

      <Textarea
        value={content}
        maxLength={MAX_CONTENT_LENGTH}
        placeholder="写下要广播的内容，例如：今日 15:00 全体学生在操场集合。"
        className="min-h-28 w-full resize-none rounded-none border-0 bg-white px-0 py-1 text-base leading-7 text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0"
        onChange={(event) => setContent(event.target.value)}
        disabled={busy}
      />

      <div className="mt-3">
        <DateTimePicker
          value={readEndsAt(endsAt)}
          onChange={(date) => setEndsAt(date ? toLocalDateTimeValue(date) : "")}
          presets={metadata.broadcastQuickPresets}
          disabled={busy}
          hint="到达该时间后通知转入历史通知"
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button className="campux-postbtn" disabled={busy || content.trim().length < 2 || !endsAt} onClick={() => void publish()}>
          <span>
            <SendIcon className="mr-1 inline size-4" />
            {busy ? "发布中" : "发布通知"}
          </span>
        </Button>
      </div>
    </section>
  );
}
