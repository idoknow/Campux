import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import type { TenantSummary } from "@campux/domain";
import { FONT_OPTIONS } from "@campux/domain";
import { ChevronDownIcon, ImagePlusIcon, LoaderIcon, MegaphoneIcon, SendIcon, EyeIcon } from "lucide-react";
import { defaultMetadata } from "@/lib/app-model";
import type { PendingAttachment, TenantMetadata } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingBlock } from "@/components/app/utility";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PostRulesAction } from "./PostRulesAction";

const BG_COLOR_OPTIONS = [
  { value: "white", label: "白", hex: "#FFFFFF" },
  { value: "pink", label: "浅粉", hex: "#FFE4E1" },
  { value: "blue", label: "浅蓝", hex: "#E0F0FF" },
  { value: "green", label: "浅绿", hex: "#E0FFE0" },
  { value: "yellow", label: "浅黄", hex: "#FFFDE0" },
  { value: "orange", label: "浅橙", hex: "#FFE8D0" },
  { value: "purple", label: "浅紫", hex: "#F0E0FF" },
] as const;

const TEXT_COLOR_OPTIONS = [
  { value: "black", label: "黑", hex: "#1a1a1a" },
  { value: "dark_red", label: "深红", hex: "#8B0000" },
  { value: "dark_blue", label: "深蓝", hex: "#00008B" },
  { value: "dark_green", label: "深绿", hex: "#006400" },
  { value: "dark_pink", label: "深粉", hex: "#C71585" },
  { value: "dark_purple", label: "深紫", hex: "#4B0082" },
  { value: "dark_orange", label: "深橙", hex: "#CC5500" },
] as const;


export function PostPage({
  busy,
  loading,
  metadata,
  postText,
  postBgColor,
  postTextColor,
  postFont,
  anonymous,
  anonymousAvatar,
  pendingAttachments,
  onPostTextChange,
  onAnonymousChange,
  onAnonymousAvatarChange,
  onBgColorChange,
  onTextColorChange,
  onFontChange,
  onFilesSelected,
  onRemoveAttachment,
  onSubmit,
}: {
  busy: boolean;
  loading: boolean;
  metadata: TenantMetadata;
  postText: string;
  postBgColor: string;
  postTextColor: string;
  postFont: string;
  anonymous: boolean;
  anonymousAvatar: string;
  selectedTenant: TenantSummary;
  pendingAttachments: PendingAttachment[];
  onPostTextChange: (value: string) => void;
  onAnonymousChange: (value: boolean) => void;
  onAnonymousAvatarChange: (value: string) => void;
  onBgColorChange: (value: string) => void;
  onTextColorChange: (value: string) => void;
  onFontChange: (value: string) => void;
  onFilesSelected: (files: ArrayLike<File> | null) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachmentToRemove, setAttachmentToRemove] = useState<PendingAttachment | null>(null);
  const [fontPreviewOpen, setFontPreviewOpen] = useState(false);
  const [fontPreviewUrl, setFontPreviewUrl] = useState<string | null>(null);
  const [fontPreviewLoading, setFontPreviewLoading] = useState(false);
  const [svgAvatars, setSvgAvatars] = useState<string[]>([]);
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;
  const sortedAttachments = [...pendingAttachments].sort((left, right) => left.sortOrder - right.sortOrder);
  const hasConverting = pendingAttachments.some((p) => p.status === "converting");
  const hasUploading = pendingAttachments.some((p) => p.status === "uploading");
  const hasNonDefaultFont = postFont && postFont !== "default";

  useEffect(() => {
    if (metadata.enableAnonymousAvatarSelection) {
      fetch("/api/svg/avatars")
        .then((res) => res.json() as Promise<{ avatars: string[] }>)
        .then((data) => setSvgAvatars(data.avatars))
        .catch(() => { /* silently ignore */ });
    }
  }, [metadata.enableAnonymousAvatarSelection]);

  // 关闭匿名时清除已选头像
  useEffect(() => {
    if (!anonymous && anonymousAvatar) {
      onAnonymousAvatarChange("");
    }
  }, [anonymous]);

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

  async function handleSubmit() {
    if (hasNonDefaultFont) {
      setFontPreviewLoading(true);
      setFontPreviewOpen(true);
      try {
        const resp = await fetch("/api/posts/render-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: postText,
            font: postFont || undefined,
            bgColor: postBgColor || undefined,
            textColor: postTextColor || undefined,
            anonymous,
          }),
        });
        if (!resp.ok) throw new Error("预览生成失败");
        const blob = await resp.blob();
        setFontPreviewUrl(URL.createObjectURL(blob));
      } catch {
        setFontPreviewUrl(null);
      } finally {
        setFontPreviewLoading(false);
      }
    } else {
      onSubmit();
    }
  }

  function confirmFontPreview() {
    if (fontPreviewUrl) URL.revokeObjectURL(fontPreviewUrl);
    setFontPreviewUrl(null);
    setFontPreviewOpen(false);
    onSubmit();
  }

  const selectedFontOption = FONT_OPTIONS.find((f) => f.value === postFont) ?? FONT_OPTIONS[0];

  function handleFontPreviewClose() {
    setFontPreviewOpen(false);
    if (fontPreviewUrl) {
      URL.revokeObjectURL(fontPreviewUrl);
      setFontPreviewUrl(null);
    }
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

        {metadata.enableColorSelection || metadata.enableFontSelection || (metadata.enableAnonymousAvatarSelection && anonymous) ? (
          <details className="mt-3 rounded-md border border-slate-200 bg-slate-50">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
              <span>高级功能</span>
              <ChevronDownIcon className="size-4 text-slate-400 transition-transform ui-open:rotate-180" />
            </summary>
            <div className="grid gap-2 border-t border-slate-200 p-3">
              {metadata.enableColorSelection ? (
                <>
                  <div className="rounded-md border px-3 py-2 text-sm product-accent-blue">
                    <div className="mb-2">
                      <span className="block font-semibold">背景颜色</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {BG_COLOR_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all ${
                            postBgColor === opt.value
                              ? "border-slate-700 bg-slate-700 text-white shadow-sm"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                          onClick={() => onBgColorChange(postBgColor === opt.value ? "" : opt.value)}
                        >
                          <span className="inline-block size-3.5 rounded-full border border-slate-200/50" style={{ backgroundColor: opt.hex }} />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border px-3 py-2 text-sm product-accent-blue">
                    <div className="mb-2">
                      <span className="block font-semibold">文字颜色</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {TEXT_COLOR_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all ${
                            postTextColor === opt.value
                              ? "border-slate-700 bg-slate-700 text-white shadow-sm"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                          onClick={() => onTextColorChange(postTextColor === opt.value ? "" : opt.value)}
                        >
                          <span className="inline-block size-3.5 rounded-full border border-slate-200/50" style={{ backgroundColor: opt.hex }} />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {metadata.enableAnonymousAvatarSelection && anonymous ? (
                <div className="rounded-md border px-3 py-2 text-sm product-accent-green">
                  <div className="mb-2">
                    <span className="block font-semibold">匿名头像</span>
                    <span className="block text-xs font-normal opacity-80">选择匿名展示时使用的头像。</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {svgAvatars.map((filename) => (
                      <button
                        key={filename}
                        type="button"
                        className={`relative h-12 w-12 overflow-hidden rounded-full border-2 transition-all ${
                          anonymousAvatar === filename
                            ? "border-green-500 ring-2 ring-green-200"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                        onClick={() => onAnonymousAvatarChange(anonymousAvatar === filename ? "" : filename)}
                        title={filename.replace(".svg", "")}
                      >
                        <img
                          src={`/api/svg/${encodeURIComponent(filename)}`}
                          alt={filename}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {metadata.enableFontSelection ? (
                <div className="rounded-md border px-3 py-2 text-sm product-accent-blue">
                  <div className="mb-2">
                    <span className="block font-semibold">字体</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {FONT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all ${
                          postFont === opt.value
                            ? "border-slate-700 bg-slate-700 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                        onClick={() => onFontChange(postFont === opt.value ? "" : opt.value)}
                        style={opt.value !== "default" && postFont === opt.value ? { fontFamily: opt.value } : {}}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        <PostRulesAction rules={rules} />

        <div className="mt-4 flex items-center gap-3">
          <button className="campux-postbtn" disabled={busy || hasUploading || hasConverting || postText.trim().length === 0} onClick={handleSubmit}>
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

      <Dialog open={fontPreviewOpen} onOpenChange={(open) => { if (!open) handleFontPreviewClose(); }}>
        <DialogContent className="w-[min(560px,calc(100vw-32px))]">
          <DialogHeader>
            <DialogTitle>字体预览</DialogTitle>
            <DialogDescription>
              你选择了「{selectedFontOption?.label}」，以下是使用该字体渲染的效果图。确认无误后提交进入审核。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center px-2">
            {fontPreviewLoading ? (
              <div className="flex min-h-[200px] items-center justify-center">
                <LoaderIcon className="size-6 animate-spin text-slate-400" />
              </div>
            ) : fontPreviewUrl ? (
              <img
                src={fontPreviewUrl}
                alt="字体预览"
                className="max-h-[60vh] w-full rounded-md border border-slate-200 object-contain"
              />
            ) : (
              <div className="flex min-h-[120px] items-center justify-center text-sm text-red-500">
                预览生成失败，请重试或取消后直接投稿。
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleFontPreviewClose}>
              取消
            </Button>
            <Button onClick={confirmFontPreview} disabled={busy || fontPreviewLoading || postText.trim().length === 0}>
              <SendIcon className="mr-1 inline size-4" />
              确认投稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
