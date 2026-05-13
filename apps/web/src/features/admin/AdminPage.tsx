import { useEffect, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import { ClipboardListIcon, MegaphoneIcon, SaveIcon, ShieldCheckIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { TenantMetadata } from "@/types/app";
import { ListButton, SectionHeader } from "@/components/app/utility";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TenantSettingsForm = {
  tenantName: string;
  slug: string;
  themeColor: string;
  brand: string;
  banner: string;
};

export function AdminPage({
  selectedTenant,
  metadata,
  onSaved,
}: {
  selectedTenant: TenantSummary;
  metadata: TenantMetadata;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<TenantSettingsForm>(() => toForm(selectedTenant, metadata));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setForm(toForm(selectedTenant, metadata));
  }, [selectedTenant.id, metadata.brand, metadata.banner]);

  async function saveSettings() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/admin/tenant/metadata", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      await onSaved();
      setNotice("校园墙信息已保存。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pb-6">
      <SectionHeader title="管理" subtitle={`${selectedTenant.name} 的审核和配置`} />

      {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</p> : null}

      <div className="mt-3 flex flex-col gap-2">
        <ListButton title="审核稿件" description={`${selectedTenant.pendingPostCount} 条待审核`} icon={ClipboardListIcon} />
        <ListButton title="发布目标" description={`${selectedTenant.botAccountCount} 个 QQ 墙号`} icon={ShieldCheckIcon} />
      </div>

      <Card className="mt-4 rounded-md">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <MegaphoneIcon className="size-4" />
            <p className="text-lg font-black">校园墙设置</p>
          </div>
          <p className="mt-1 text-sm text-slate-500">这些信息属于当前校园墙，由租户管理员维护。</p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              校园墙名称
              <Input value={form.tenantName} onChange={(event) => setForm({ ...form, tenantName: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              slug
              <Input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              主题色
              <Input value={form.themeColor} onChange={(event) => setForm({ ...form, themeColor: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              前台品牌名
              <Input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} />
            </label>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              前台公告
              <Input value={form.banner} onChange={(event) => setForm({ ...form, banner: event.target.value })} />
            </label>
          </div>

          <Button className="mt-4 rounded-full bg-[#42a5f5] px-5 font-bold hover:bg-[#42a5f5]" disabled={busy} onClick={() => void saveSettings()}>
            <SaveIcon data-icon="inline-start" />
            保存设置
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function toForm(selectedTenant: TenantSummary, metadata: TenantMetadata): TenantSettingsForm {
  return {
    tenantName: selectedTenant.name,
    slug: selectedTenant.slug,
    themeColor: selectedTenant.themeColor,
    brand: metadata.brand,
    banner: metadata.banner,
  };
}
