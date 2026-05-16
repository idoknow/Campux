import { useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { TenantSummary } from "@campux/domain";
import { ImagePlusIcon, MegaphoneIcon, SendIcon } from "lucide-react";
import { defaultMetadata } from "@/lib/app-model";
import type { TenantMetadata, UploadedImage } from "@/types/app";
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
  selectedTenant,
  uploadedImages,
  onPostTextChange,
  onAnonymousChange,
  onFilesSelected,
  onRemoveImage,
  onSubmit,
}: {
  busy: boolean;
  loading: boolean;
  metadata: TenantMetadata;
  postText: string;
  anonymous: boolean;
  selectedTenant: TenantSummary;
  uploadedImages: UploadedImage[];
  onPostTextChange: (value: string) => void;
  onAnonymousChange: (value: boolean) => void;
  onFilesSelected: (files: ArrayLike<File> | null) => void;
  onRemoveImage: (key: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageToRemove, setImageToRemove] = useState<UploadedImage | null>(null);
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;

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

  function confirmRemoveImage() {
    if (!imageToRemove) {
      return;
    }
    onRemoveImage(imageToRemove.key);
    setImageToRemove(null);
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
        <Textarea
          value={postText}
          maxLength={1000}
          placeholder="有什么新鲜事？！"
          className="min-h-36 w-full resize-none rounded-none border-0 bg-white px-0 py-1 text-base leading-7 text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0"
          onChange={(event) => onPostTextChange(event.target.value)}
          onPaste={pasteImages}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {uploadedImages.map((image) => (
            <button key={image.key} className="h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-100" onClick={() => setImageToRemove(image)}>
              <img src={image.previewUrl} alt={image.fileName} className="h-full w-full object-cover" />
            </button>
          ))}
          {uploadedImages.length < 9 ? (
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

        <div className="mt-3 w-fit rounded-md border px-3 py-2 text-sm product-accent-green">
          <div className="flex items-center gap-3">
            <span>匿名投稿</span>
            <Switch checked={anonymous} onCheckedChange={onAnonymousChange} aria-label="匿名投稿" />
          </div>
        </div>

        <PostRulesAction rules={rules} />

        <div className="mt-4 flex items-center gap-3">
          <button className="campux-postbtn" disabled={busy || postText.trim().length === 0} onClick={onSubmit}>
            <span>
              <SendIcon className="mr-1 inline size-4" />
              {busy ? "提交中" : "投稿"}
            </span>
          </button>
          <span className="text-xs text-slate-500">{postText.length}/1000</span>
        </div>
      </section>

      <section className="mt-3 rounded-md border border-blue-100 bg-blue-50/45 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">稿件状态</p>
            <p className="mt-1 text-sm text-slate-500">审核通过后会同步到 {selectedTenant.botAccountCount} 个墙号。</p>
            <p className="mt-1 text-xs text-slate-500">
              {metadata.pendingPostLimit > 0 ? `每人最多同时保留 ${metadata.pendingPostLimit} 条待审核稿件。` : "当前不限制待审核稿件数量。"}
            </p>
          </div>
          <Badge variant="secondary" className="rounded-md shadow-none">
            无阻塞
          </Badge>
        </div>
      </section>

      <Dialog open={Boolean(imageToRemove)} onOpenChange={(open) => !open && setImageToRemove(null)}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>删除这张图片？</DialogTitle>
            <DialogDescription>删除后如果还需要这张图，需要重新选择或粘贴上传。</DialogDescription>
          </DialogHeader>
          {imageToRemove ? (
            <div className="px-5">
              <img src={imageToRemove.previewUrl} alt={imageToRemove.fileName} className="max-h-72 w-full rounded-md border border-slate-200 bg-slate-50 object-contain" />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImageToRemove(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmRemoveImage}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
