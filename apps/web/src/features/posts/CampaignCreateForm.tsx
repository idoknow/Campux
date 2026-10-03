import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FullImageLightbox, ImageCropField } from "./CampaignImageControls";
import type { TenantMetadata } from "@/types/app";

type CropRect = { x: number; y: number; width: number; height: number };
type OptionForm = { label: string; original: string | null; originalWidth: number; originalHeight: number; crop: CropRect; dataUrl: string | null };
type CampaignImage = { original: string | null; originalWidth: number; originalHeight: number; crop: CropRect; dataUrl: string | null };

const COVER_ASPECT = 16 / 9;
const OPTION_ASPECT = 1;

function emptyOption(): OptionForm {
  return { label: "", original: null, originalWidth: 0, originalHeight: 0, crop: { x: 0, y: 0, width: 0, height: 0 }, dataUrl: null };
}

function emptyImage(): CampaignImage {
  return { original: null, originalWidth: 0, originalHeight: 0, crop: { x: 0, y: 0, width: 0, height: 0 }, dataUrl: null };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cropRect(x: number, y: number, width: number, height: number) {
  return { x: clamp(x, 0, Math.max(0, width - 100)), y: clamp(y, 0, Math.max(0, height - 100)), width, height };
}

function loadNaturalImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法读取"));
    image.src = dataUrl;
  });
}

function centerCrop(originalWidth: number, originalHeight: number, aspect: number): CropRect {
  if (!originalWidth || !originalHeight) return { x: 0, y: 0, width: 0, height: 0 };
  if (originalWidth / originalHeight > aspect) {
    const width = originalWidth;
    const height = Math.round(originalWidth / aspect);
    return { x: 0, y: Math.max(0, Math.floor((originalHeight - height) / 2)), width, height };
  }
  const width = Math.round(originalHeight * aspect);
  const height = Math.round(originalWidth / aspect);
  return { x: Math.max(0, Math.floor((originalWidth - width) / 2)), y: 0, width, height };
}

function renderCrop(image: HTMLImageElement, crop: CropRect) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(768 / Math.max(1, crop.width), 512 / Math.max(1, crop.height), 2);
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法生成预览");
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

export function CampaignCreateForm({
  metadata,
  onSuccess,
  onCancel,
}: {
  metadata: TenantMetadata;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [coverImage, setCoverImage] = useState<CampaignImage>(emptyImage);
  const [anonymous, setAnonymous] = useState(false);
  const [votesPerPerson, setVotesPerPerson] = useState(1);
  const [allowStackOnOption, setAllowStackOnOption] = useState(false);
  const [durationHours, setDurationHours] = useState(24);
  const [showVoterDetails, setShowVoterDetails] = useState(true);
  const [options, setOptions] = useState<OptionForm[]>([emptyOption(), emptyOption()]);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const optionInputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const coverReadSeq = useRef(0);

  function readDataUrl(file: File, maxLengthMb = 8): Promise<string> {
    return new Promise((resolve, reject) => {
      if (file.size > maxLengthMb * 1024 * 1024) {
        reject(new Error(`图片不能超过 ${maxLengthMb}MB`));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  }

  async function prepareImage(dataUrl: string, aspect: number): Promise<CampaignImage> {
    const image = await loadNaturalImage(dataUrl);
    const crop = centerCrop(image.naturalWidth, image.naturalHeight, aspect);
    return { original: dataUrl, originalWidth: image.naturalWidth, originalHeight: image.naturalHeight, crop, dataUrl: renderCrop(image, crop) };
  }

  async function onCoverChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const seq = ++coverReadSeq.current;
    try {
      const dataUrl = await readDataUrl(file);
      if (seq !== coverReadSeq.current) return;
      setCoverImage(await prepareImage(dataUrl, COVER_ASPECT));
    } catch (error) {
      if (seq !== coverReadSeq.current) return;
      toast.error(error instanceof Error ? error.message : "封面读取失败");
    }
  }

  async function updateCoverCrop(nextCrop: CropRect) {
    const original = coverImage.original;
    if (!original) return;
    const image = await loadNaturalImage(original);
    setCoverImage({ ...coverImage, crop: nextCrop, dataUrl: renderCrop(image, nextCrop) });
  }

  async function onOptionImageChange(index: number, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readDataUrl(file);
      const prepared = await prepareImage(dataUrl, OPTION_ASPECT);
      setOptions((current) => current.map((entry, i) => (i === index ? { ...entry, ...prepared } : entry)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选项图片读取失败");
    }
  }

  function updateOption(index: number, patch: Partial<OptionForm>) {
    setOptions((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function updateOptionCrop(index: number, nextCrop: CropRect) {
    const target = options[index];
    if (!target?.original) return;
    const image = new Image();
    image.onload = () => updateOption(index, { crop: nextCrop, dataUrl: renderCrop(image, nextCrop) });
    image.onerror = () => updateOption(index, { crop: nextCrop, dataUrl: target.original });
    image.src = target.original;
  }

  function addOption() {
    setOptions((current) => current.length >= 20 ? current : [...current, emptyOption()]);
  }

  function removeOption(index: number) {
    setOptions((current) => current.length <= 2 ? current : current.filter((_, i) => i !== index));
  }

  async function submit() {
    if (title.trim().length < 2) {
      toast.error("标题至少 2 个字");
      return;
    }
    const validOptions = options.map((entry) => ({ label: entry.label, image: entry.dataUrl }));
    if (validOptions.length < 2) {
      toast.error("至少需要 2 个选项");
      return;
    }
    if (validOptions.some((entry) => entry.label.trim().length === 0)) {
      toast.error("请填写所有选项名称");
      return;
    }
    setBusy(true);
    try {
      await api("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          cover: coverImage.dataUrl ?? undefined,
          anonymous,
          votesPerPerson,
          allowStackOnOption,
          durationHours,
          showVoterDetails,
          options: validOptions,
        }),
      });
      toast.success("已提交竞选审核");
      onSuccess();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-surface p-4">
      <h2 className="text-sm font-semibold text-slate-950">发起竞选</h2>
      <div className="mt-3 space-y-3">
        <Input placeholder="竞选标题（2-60字）" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} />
        <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={onCoverChange} />
        <ImageCropField
          label="封面"
          original={coverImage.original}
          originalWidth={coverImage.originalWidth}
          originalHeight={coverImage.originalHeight}
          crop={coverImage.crop}
          aspect={COVER_ASPECT}
          width={360}
          height={225}
          onChange={updateCoverCrop}
          onPick={() => coverInputRef.current?.click()}
          onRemove={() => { coverReadSeq.current += 1; setCoverImage(emptyImage()); }}
        />
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">竞选选项</p>
          {options.map((option, index) => (
            <div key={index} className="space-y-2 rounded-md border border-slate-200 p-2">
              <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-500">{index + 1}</span>
                <Input placeholder="选项名称" value={option.label} onChange={(event) => updateOption(index, { label: event.target.value })} maxLength={40} />
                {option.dataUrl ? <button type="button" onClick={() => setLightbox(option.dataUrl)} className="size-8 shrink-0 overflow-hidden rounded border border-slate-200"><img src={option.dataUrl} alt="" className="size-8 rounded object-cover" /></button> : null}
                <input type="file" accept="image/*" ref={(el) => { optionInputsRef.current[index] = el; }} className="hidden" onChange={(event) => void onOptionImageChange(index, event)} />
                <Button size="sm" variant="outline" onClick={() => optionInputsRef.current[index]?.click()}>图</Button>
                {options.length > 2 ? <Button size="sm" variant="ghost" onClick={() => removeOption(index)}>删除</Button> : null}
              </div>
              <ImageCropField
                label={`选项 ${index + 1}`}
                original={option.original}
                originalWidth={option.originalWidth}
                originalHeight={option.originalHeight}
                crop={option.crop}
                aspect={OPTION_ASPECT}
                width={180}
                height={180}
                onChange={(crop) => updateOptionCrop(index, crop)}
                onPick={() => optionInputsRef.current[index]?.click()}
                onRemove={() => updateOption(index, emptyOption())}
              />
            </div>
          ))}
          {options.length < 20 ? <Button size="sm" variant="outline" onClick={addOption}><PlusIcon className="size-4" />添加选项</Button> : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={anonymous} onCheckedChange={setAnonymous} disabled={!metadata.allowAnonymousCampaign} />
            匿名发起{!metadata.allowAnonymousCampaign ? "（未开启）" : ""}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showVoterDetails} onCheckedChange={setShowVoterDetails} />
            展示投票人明细
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="flex items-center gap-2 text-sm">
              <Switch checked={allowStackOnOption} onCheckedChange={setAllowStackOnOption} disabled={votesPerPerson <= 1} />
              <span>
                <span className="block">允许给同一选项投多张票</span>
                <span className="block text-xs text-slate-500">开启后，每人可将自己的多张票全部投给同一个选项；关闭则每个选项最多投 1 票。</span>
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            每人可投：<Input type="number" min={1} max={20} value={votesPerPerson} onChange={(event) => {
              const next = Math.max(1, Math.min(20, Number(event.target.value) || 1));
              setVotesPerPerson(next);
              if (next <= 1) setAllowStackOnOption(false);
            }} className="w-20" />票
          </label>
          <label className="flex items-center gap-2 text-sm">
            时长：<Input type="number" min={12} max={8760} value={durationHours} onChange={(event) => {
              setDurationHours(Math.max(12, Math.min(8760, Number(event.target.value) || 12)));
            }} className="w-24" />小时
          </label>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中..." : "提交审核"}</Button>
        </div>
      </div>
      <FullImageLightbox src={lightbox} alt="竞选图片原图" onClose={() => setLightbox(null)} />
    </section>
  );
}
