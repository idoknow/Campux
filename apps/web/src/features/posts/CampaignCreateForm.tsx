import { useRef, useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { TenantMetadata } from "@/types/app";

type OptionForm = { label: string; dataUrl: string | null };

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
  const [cover, setCover] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [votesPerPerson, setVotesPerPerson] = useState(1);
  const [allowStackOnOption, setAllowStackOnOption] = useState(false);
  const [durationHours, setDurationHours] = useState(24);
  const [showVoterDetails, setShowVoterDetails] = useState(true);
  const [options, setOptions] = useState<OptionForm[]>([
    { label: "", dataUrl: null },
    { label: "", dataUrl: null },
  ]);
  const [busy, setBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const optionInputsRef = useRef<Array<HTMLInputElement | null>>([]);

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

  async function onCoverChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCover(await readDataUrl(file));
  }

  async function onOptionImageChange(index: number, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await readDataUrl(file);
    setOptions((current) => current.map((entry, i) => (i === index ? { ...entry, dataUrl } : entry)));
  }

  function updateOption(index: number, patch: Partial<OptionForm>) {
    setOptions((current) => current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  }

  function addOption() {
    setOptions((current) => current.length >= 20 ? current : [...current, { label: "", dataUrl: null }]);
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
          cover: cover ?? undefined,
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
        <div>
          <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={onCoverChange} />
          {cover ? (
            <div className="flex items-center gap-2 rounded border border-slate-200 p-2">
              <img src={cover} alt="" className="h-14 w-14 rounded object-cover" />
              <Button size="sm" variant="ghost" onClick={() => setCover(null)}>更换封面</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => coverInputRef.current?.click()}>选择封面（可选）</Button>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">竞选选项</p>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded bg-slate-100 text-xs text-slate-500">{index + 1}</span>
              <Input placeholder="选项名称" value={option.label} onChange={(event) => updateOption(index, { label: event.target.value })} maxLength={40} />
              {option.dataUrl ? <img src={option.dataUrl} alt="" className="size-8 rounded object-cover" /> : null}
              <input type="file" accept="image/*" ref={(el) => { optionInputsRef.current[index] = el; }} className="hidden" onChange={(event) => void onOptionImageChange(index, event)} />
              <Button size="sm" variant="outline" onClick={() => optionInputsRef.current[index]?.click()}>图</Button>
              {options.length > 2 ? <Button size="sm" variant="ghost" onClick={() => removeOption(index)}>删除</Button> : null}
            </div>
          ))}
          {options.length < 20 ? <Button size="sm" variant="outline" onClick={addOption}><PlusIcon className="size-4" />添加选项</Button> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={anonymous} onCheckedChange={setAnonymous} disabled={!metadata.allowAnonymousCampaign} />
            匿名发起{!metadata.allowAnonymousCampaign ? "（未开启）" : ""}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showVoterDetails} onCheckedChange={setShowVoterDetails} />
            展示投票人明细
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={allowStackOnOption} onCheckedChange={setAllowStackOnOption} />
            允许同选多张
          </label>
          <label className="flex items-center gap-2 text-sm">
            每人数：<Input type="number" min={1} max={20} value={votesPerPerson} onChange={(event) => setVotesPerPerson(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} className="w-16" />
          </label>
          <label className="flex items-center gap-2 text-sm col-span-2">
            时长（小时，最小 12 最大 8760）：<Input type="number" min={12} max={8760} value={durationHours} onChange={(event) => setDurationHours(Math.max(12, Math.min(8760, Number(event.target.value) || 12)))} className="w-32" />
          </label>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中..." : "提交审核"}</Button>
        </div>
      </div>
    </section>
  );
}
