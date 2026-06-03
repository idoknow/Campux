import { useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { TenantSummary } from "@campux/domain";
import { ImagePlusIcon, MegaphoneIcon, SendIcon } from "lucide-react";
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
  pendingAttachments,
  onPostTextChange,
  onAnonymousChange,
  onFilesSelected,
  onRemoveAttachment,
  onSubmit,
}: {
  busy: boolean;
  loading: boolean;
  metadata: TenantMetadata;
  postText: string;
  anonymous: boolean;
  selectedTenant: TenantSummary;
  pendingAttachments: PendingAttachment[];
  onPostTextChange: (value: string) => void;
  onAnonymousChange: (value: boolean) => void;
  onFilesSelected: (files: ArrayLike<File> | null) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachmentToRemove, setAttachmentToRemove] = useState<PendingAttachment | null>(null);
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;
  const sortedAttachments = [...pendingAttachments].sort((left, right) => left.sortOrder - right.sortOrder);
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
              disabled={item.status === "uploading"}
              onClick={() => setAttachmentToRemove(item)}
            >
              <img src={item.blobUrl} alt={item.file.name} className="h-full w-full object-cover" />
              {item.status === "uploading" ? (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-200">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.max(item.progress, 2)}%` }} />
                </div>
              ) : null}
              {item.status === "failed" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-red-500/35 px-1 text-center text-[11px] font-medium leading-tight text-red-900">
                  <span>上传失败</span>
                  <span className="line-clamp-2 max-w-full break-words font-normal">{item.errorMessage || "请重试"}</span>
                </div>
              ) : null}
            </button>
          ))}
          {pendingAttachments.length < 9 ? (
            <Button
              variant="outline"
              className="h-16 w-16 rounded-md border border-dashed border-slate-300 bg-white p-0 text-slate-500 shadow-none hover:bg-slate-50"
              disabled={busy}
              aria-label="添加图片"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon className="!size-7 stroke-[1.8]" />
            </Button>
          ) : null}
          <input ref={inputRef} hidden multiple accept="image/*" type="file" onChange={(event) => onFilesSelected(event.target.files)} />
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">最多 9 张图片，单张 ≤ 10MB。可直接粘贴截图，提交时会一起上传。</p>

        <div className="mt-3 rounded-md border px-3 py-2 text-sm product-accent-green">
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-semibold">匿名展示</span>
              <span className="block text-xs font-normal opacity-80">审核员仍可查看必要的投稿记录。</span>
            </span>
            <Switch checked={anonymous} onCheckedChange={onAnonymousChange} disabled={busy} aria-label="匿名展示" />
          </div>
        </div>

        <PostRulesAction rules={rules} />

        <div className="mt-4 flex items-center gap-3">
          <button className="campux-postbtn" disabled={busy || hasUploading || postText.trim().length === 0} onClick={onSubmit}>
            <span>
              <SendIcon className="mr-1 inline size-4" />
              {busy ? "提交中" : "提交投稿"}
            </span>
          </button>
          <span className="text-xs text-slate-500">{hasUploading ? "图片上传中，请稍候" : "提交后进入审核"}</span>
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
