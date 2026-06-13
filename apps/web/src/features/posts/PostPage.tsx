import { useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { TenantSummary } from "@campux/domain";

const BG_COLORS = [
  { name: "白色", hex: "#ffffff" },
  { name: "浅粉", hex: "#FFE4E1" },
  { name: "浅蓝", hex: "#E3F2FD" },
  { name: "浅绿", hex: "#E8F5E9" },
  { name: "浅黄", hex: "#FFFDE7" },
  { name: "浅橙", hex: "#FFF3E0" },
  { name: "浅紫", hex: "#F3E5F5" },
];

const TEXT_COLORS = [
  { name: "黑色", hex: "#000000" },
  { name: "深红", hex: "#8B0000" },
  { name: "深蓝", hex: "#00008B" },
  { name: "深绿", hex: "#006400" },
  { name: "深粉", hex: "#C71585" },
  { name: "深紫", hex: "#4A148C" },
  { name: "深橙", hex: "#E65100" },
];

function getTextContrastColor(hex: string): string {
  // 简单亮度判断：深色背景用白色文字，浅色背景用黑色文字
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? "#333333" : "#ffffff";
}
import { ImagePlusIcon, LoaderIcon, MegaphoneIcon, SendIcon } from "lucide-react";
import { defaultMetadata } from "@/lib/app-model";
import type { PendingAttachment, TenantMetadata } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingBlock } from "@/components/app/utility";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PostRulesAction } from "./PostRulesAction";

export function PostPage({
  busy,
  loading,
  metadata,
  postText,
  anonymous,
  bgColor,
  textColor,
  pendingAttachments,
  onPostTextChange,
  onAnonymousChange,
  onFilesSelected,
  onRemoveAttachment,
  onSubmit,
  onBgColorChange,
  onTextColorChange,
}: {
  busy: boolean;
  loading: boolean;
  metadata: TenantMetadata;
  postText: string;
  anonymous: boolean;
  bgColor: string;
  textColor: string;
  selectedTenant: TenantSummary;
  pendingAttachments: PendingAttachment[];
  onPostTextChange: (value: string) => void;
  onAnonymousChange: (value: boolean) => void;
  onFilesSelected: (files: ArrayLike<File> | null) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
  onBgColorChange: (color: string) => void;
  onTextColorChange: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachmentToRemove, setAttachmentToRemove] = useState<PendingAttachment | null>(null);
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;
  const sortedAttachments = [...pendingAttachments].sort((left, right) => left.sortOrder - right.sortOrder);
  const hasConverting = pendingAttachments.some((p) => p.status === "converting");
  const hasUploading = pendingAttachments.some((p) => p.status === "uploading");

  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    onFilesSelected(files);
  }

  function confirmRemoveAttachment() {
    if (!attachmentToRemove) {
      return;
    }
    onRemoveAttachment(attachmentToRemove.id);
    setAttachmentToRemove(null);
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4 pb-24 md:pb-6">
      {loading ? <LoadingBlock title="正在加载校园墙配置..." /> : null}
      {metadata.banner ? (
        <div className="mb-3 flex min-h-9 items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
          <MegaphoneIcon className="mt-0.5 size-4 shrink-0" strokeWidth={2.3} />
          <p className="min-w-0 whitespace-pre-wrap break-words">{metadata.banner}</p>
        </div>
      ) : null}

      <section className="product-surface p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">写一条投稿</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">审核通过后会发布到校园墙，匿名开关只影响对外展示。</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{postText.length}/1000</span>
        </div>
        <Textarea
          value={postText}
          maxLength={1000}
          placeholder="写下想投稿的内容，地点、时间、联系方式等信息尽量写清楚。"
          className="min-h-36 w-full resize-none rounded-none border-0 bg-white px-0 py-1 text-base leading-7 text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0"
          onChange={(event) => onPostTextChange(event.target.value)}
          onPaste={pasteImages}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {sortedAttachments.map((item) => (
            <button
              key={item.id}
              className="relative h-[70px] w-[70px] overflow-hidden rounded-md border border-slate-200 bg-slate-100"
              disabled={item.status === "uploading" || item.status === "converting"}
              onClick={() => setAttachmentToRemove(item)}
            >
              {item.originalVideo && item.status === "converting" ? (
                <video src={item.blobUrl} className="h-full w-full object-cover" muted />
              ) : (
                <img src={item.blobUrl} alt={item.file.name} className="h-full w-full object-cover" />
              )}
              {item.status === "converting" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
                  <LoaderIcon className="size-5 animate-spin text-white" />
                  <span className="mt-0.5 text-[10px] font-medium text-white/90">
                    {item.progress > 0 ? `上传转码中 ${item.progress}%` : "准备中"}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-200/50">
                    <div className="h-full bg-green-400 transition-all" style={{ width: `${Math.max(item.progress, 2)}%` }} />
                  </div>
                </div>
              ) : null}
              {item.originalVideo && item.status === "ready" ? (
                <div className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/50 px-1 py-0.5 text-[9px] font-medium text-white">
                  GIF
                </div>
              ) : null}
              {item.status === "uploading" ? (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-200">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.max(item.progress, 2)}%` }} />
                </div>
              ) : null}
              {item.status === "failed" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-red-500/35 px-1 text-center text-[11px] font-medium leading-tight text-red-900">
                  <span>转换失败</span>
                  <span className="line-clamp-2 max-w-full break-words font-normal">{item.errorMessage || "请重试"}</span>
                </div>
              ) : null}
            </button>
          ))}
          {pendingAttachments.length < 9 ? (
            <Button
              variant="outline"
              className="h-16 w-16 rounded-md border border-dashed border-slate-300 bg-white p-0 text-slate-500 shadow-none hover:bg-slate-50"
              disabled={busy || hasConverting}
              aria-label="添加图片或视频"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon className="!size-7 stroke-[1.8]" />
            </Button>
          ) : null}
          <input ref={inputRef} hidden multiple accept="image/*,video/*" type="file" onChange={(event) => onFilesSelected(event.target.files)} />
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          最多 9 个文件。图片 ≤ 10MB，视频 ≤ 15MB（上传后自动转为 GIF）。
          {hasConverting ? (
            <span className="ml-1 text-amber-600">视频转换中，请稍候…</span>
          ) : null}
          可直接粘贴截图。
        </p>

        <div className="mt-3 rounded-md border px-3 py-2 text-sm product-accent-green">
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-semibold">匿名展示</span>
              <span className="block text-xs font-normal opacity-80">审核员仍可查看必要的投稿记录。</span>
            </span>
            <Switch checked={anonymous} onCheckedChange={onAnonymousChange} disabled={busy} aria-label="匿名展示" />
          </div>
        </div>

        {/* 颜色选择 */}
        <div className="mt-3 space-y-2">
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
              配色设置 <span className="ml-1 opacity-50 group-open:rotate-180 inline-block transition-transform">▾</span>
            </summary>
            <div className="mt-2 space-y-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">背景色</p>
                <div className="flex flex-wrap gap-2">
                  {BG_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      className={`h-7 w-7 rounded-full border-2 transition-all ${
                        bgColor === c.hex ? "border-slate-700 scale-110 shadow-sm" : "border-slate-200 hover:border-slate-400"
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                      onClick={() => onBgColorChange(c.hex)}
                      aria-label={`背景色 ${c.name}`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">文字色</p>
                <div className="flex flex-wrap gap-2">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all ${
                        textColor === c.hex ? "border-slate-700 scale-110 shadow-sm" : "border-slate-200 hover:border-slate-400"
                      }`}
                      style={{ backgroundColor: c.hex, color: c.hex === "#000000" ? "#fff" : "#fff" }}
                      title={c.name}
                      onClick={() => onTextColorChange(c.hex)}
                      aria-label={`文字色 ${c.name}`}
                    >
                      {/* 深色背景显示 A，浅色背景显示 A 用高对比 */}
                      <span style={{ color: getTextContrastColor(c.hex) }}>A</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>

        <PostRulesAction rules={rules} />

        <div className="mt-4 flex items-center gap-3">
          <button className="campux-postbtn" disabled={busy || hasUploading || hasConverting || postText.trim().length === 0} onClick={onSubmit}>
            <span>
              <SendIcon className="mr-1 inline size-4" />
              {busy ? "提交中" : "提交投稿"}
            </span>
          </button>
          <span className="text-xs text-slate-500">
            {hasConverting ? "视频上传转码中，请稍候" : hasUploading ? "图片上传中，请稍候" : "提交后进入审核"}
          </span>
        </div>
      </section>

      <section className="mt-3 rounded-md border border-blue-100 bg-blue-50/45 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">稿件状态</p>
            <p className="mt-1 text-sm text-slate-500">审核通过后会自动发布到校园墙。</p>
            <p className="mt-1 text-xs text-slate-500">
              {metadata.pendingPostLimit > 0 ? `每人最多同时保留 ${metadata.pendingPostLimit} 条待审核稿件。` : "当前不限制待审核稿件数量。"}
            </p>
          </div>
          <Badge variant="secondary" className="rounded-md shadow-none">
            可投稿
          </Badge>
        </div>
      </section>

      <Dialog open={Boolean(attachmentToRemove)} onOpenChange={(open) => !open && setAttachmentToRemove(null)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>{attachmentToRemove?.status === "failed" ? "移除这张图片？" : "删除这张图片？"}</DialogTitle>
            <DialogDescription>
              {attachmentToRemove?.status === "failed"
                ? attachmentToRemove.errorMessage || "这张图片上传失败，移除后可以重新选择。"
                : "删除后需要重新选择或粘贴。"}
            </DialogDescription>
          </DialogHeader>
          {attachmentToRemove ? (
            <div className="px-5">
              <img src={attachmentToRemove.blobUrl} alt={attachmentToRemove.file.name} className="max-h-72 w-full rounded-md border border-slate-200 bg-slate-50 object-contain" />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachmentToRemove(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmRemoveAttachment}>
              {attachmentToRemove?.status === "failed" ? "移除" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
