import { useRef } from "react";
import type { TenantSummary } from "@campux/domain";
import { CheckIcon, ImagePlusIcon, MegaphoneIcon, SendIcon } from "lucide-react";
import { defaultMetadata } from "@/lib/app-model";
import type { TenantMetadata, UploadedImage } from "@/types/app";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PostRulesAction } from "./PostRulesAction";

export function PostPage({
  busy,
  error,
  metadata,
  notice,
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
  error: string;
  metadata: TenantMetadata;
  notice: string;
  postText: string;
  anonymous: boolean;
  selectedTenant: TenantSummary;
  uploadedImages: UploadedImage[];
  onPostTextChange: (value: string) => void;
  onAnonymousChange: (value: boolean) => void;
  onFilesSelected: (files: FileList | null) => void;
  onRemoveImage: (key: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;

  return (
    <div className="flex flex-col">
      {metadata.banner ? (
        <div className="flex min-h-10 items-center gap-2 bg-[#f8b94c] px-4 py-2 text-sm text-white">
          <MegaphoneIcon className="size-4 shrink-0" strokeWidth={2.3} />
          <p className="min-w-0 truncate">{metadata.banner}</p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mx-4 my-2">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert className="mx-4 my-2 border-green-200 bg-green-50">
          <CheckIcon />
          <AlertTitle>提交成功</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <section className="px-4 pt-4">
        <Textarea
          value={postText}
          maxLength={1000}
          placeholder="有什么新鲜事？！"
          className="min-h-40 w-full resize-none rounded-none border-0 bg-white px-0 py-2 text-lg leading-8 text-slate-900 shadow-none placeholder:text-slate-500 focus-visible:ring-0"
          onChange={(event) => onPostTextChange(event.target.value)}
        />

        <div className="mt-2 flex flex-wrap gap-2">
          {uploadedImages.map((image) => (
            <button key={image.key} className="h-[70px] w-[70px] overflow-hidden rounded-[10px] bg-slate-100" onClick={() => onRemoveImage(image.key)}>
              <img src={image.previewUrl} alt={image.fileName} className="h-full w-full object-cover" />
            </button>
          ))}
          {uploadedImages.length < 9 ? (
            <Button
              variant="outline"
              className="h-[70px] w-[70px] rounded-none border-0 bg-white p-0 text-black shadow-none hover:bg-white"
              disabled={busy}
              aria-label="添加图片"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon className="!size-[70px] stroke-[1.35]" />
            </Button>
          ) : null}
          <input ref={inputRef} hidden multiple accept="image/*" type="file" onChange={(event) => onFilesSelected(event.target.files)} />
        </div>

        <div className="mt-3 w-fit rounded-[5px] bg-[#8bc34a] px-2 py-1 text-lg text-white shadow-sm">
          <div className="flex items-center gap-4">
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
          <span className="text-xs text-slate-400">{postText.length}/1000</span>
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-md bg-sky-50 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">稿件状态</p>
            <p className="mt-1 text-sm text-slate-500">审核通过后会同步到 {selectedTenant.botAccountCount} 个墙号。</p>
          </div>
          <Badge variant="secondary" className="rounded-md shadow-none">
            无阻塞
          </Badge>
        </div>
      </section>
    </div>
  );
}
