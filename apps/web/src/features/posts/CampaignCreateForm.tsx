import { useRef, useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FullImageLightbox, ImageCropDialog } from "./CampaignImageControls";
import type { TenantMetadata } from "@/types/app";

type OptionForm = { label: string; original: string | null; dataUrl: string | null };
type CampaignImage = { original: string | null; dataUrl: string | null };

type CropDraft = { title: string; dataUrl: string; optionIndex?: number };
const COVER_ASPECT = 16 / 9;
const OPTION_ASPECT = 1;

function emptyOption(): OptionForm {
  return { label: "", original: null, dataUrl: null };
}

function emptyImage(): CampaignImage {
  return { original: null, dataUrl: null };
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
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
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

  const cropAspect = cropDraft?.title.startsWith("选项") ? OPTION_ASPECT : COVER_ASPECT;

  async function onCoverChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const seq = ++coverReadSeq.current;
    try {
      const dataUrl = await readDataUrl(file);
      if (seq !== coverReadSeq.current) return;
      setCropDraft({ title: "封面", dataUrl });
    } catch (error) {
      if (seq !== coverReadSeq.current) return;
      toast.error(error instanceof Error ? error.message : "封面读取失败");
    }
  }

  async function onOptionImageChange(index: number, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readDataUrl(file);
      setCropDraft({ title: `选项 ${index + 1}`, dataUrl, optionIndex: index });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "选项图片读取失败");
    }
  }

  function updateOption(index: number, patch: Partial<OptionForm>) {
    setOptions((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
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
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">封面预览（16:9）</p>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => coverInputRef.current?.click()}>选择封面</Button>
              {coverImage.dataUrl ? <Button size="sm" variant="ghost" onClick={() => { coverReadSeq.current += 1; setCoverImage(emptyImage()); }}>移除</Button> : null}
            </div>
          </div>
          {coverImage.dataUrl ? (
            <button type="button" onClick={() => setLightbox(coverImage.original ?? coverImage.dataUrl)} className="relative mx-auto block w-full max-w-[360px] overflow-hidden rounded border border-slate-200" style={{ aspectRatio: `${COVER_ASPECT}` }} aria-label="点击查看封面原图">
              <img src={coverImage.dataUrl} alt="" className="size-full object-cover" />
            </button>
          ) : <div className="mx-auto grid w-full max-w-[360px] place-items-center rounded border border-dashed border-slate-300 bg-white py-8 text-xs text-slate-500" style={{ aspectRatio: `${COVER_ASPECT}` }}>暂无封面</div>}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">竞选选项</p>
          {options.map((option, index) => (
            <div key={index} className="space-y-2 rounded-md border border-slate-200 p-2">
              <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-500">{index + 1}</span>
                <Input placeholder="选项名称" value={option.label} onChange={(event) => updateOption(index, { label: event.target.value })} maxLength={40} />
                {option.dataUrl ? <button type="button" onClick={() => setLightbox(option.original ?? option.dataUrl)} className="size-8 shrink-0 overflow-hidden rounded border border-slate-200"><img src={option.dataUrl} alt="" className="size-8 rounded object-cover" /></button> : null}
                <input type="file" accept="image/*" ref={(el) => { optionInputsRef.current[index] = el; }} className="hidden" onChange={(event) => void onOptionImageChange(index, event)} />
                <Button size="sm" variant="outline" onClick={() => optionInputsRef.current[index]?.click()}>图</Button>
                {options.length > 2 ? <Button size="sm" variant="ghost" onClick={() => removeOption(index)}>删除</Button> : null}
              </div>
              <p className="text-[11px] text-slate-500">{option.dataUrl ? `选项 ${index + 1}：已选择图片，点击左侧小图查看原图` : `选项 ${index + 1}：可选图片（1:1 裁切预览）`}</p>
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
      <ImageCropDialog
        open={Boolean(cropDraft)}
        title={cropDraft?.title ?? ""}
        dataUrl={cropDraft?.dataUrl ?? null}
        aspect={cropAspect}
        onCancel={() => setCropDraft(null)}
        onConfirm={(prepared) => {
          if (!cropDraft) return;
          if (cropDraft.title === "封面") {
            setCoverImage(prepared);
          } else if (cropDraft.optionIndex !== undefined) {
            updateOption(cropDraft.optionIndex, { original: prepared.original, dataUrl: prepared.dataUrl });
          }
          setCropDraft(null);
        }}
      />
      <FullImageLightbox src={lightbox} alt="竞选图片原图" onClose={() => setLightbox(null)} />
    </section>
  );
}
