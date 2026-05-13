import type { TenantSummary } from "@campux/domain";
import { ClipboardListIcon, MegaphoneIcon, ShieldCheckIcon } from "lucide-react";
import { ListButton, SectionHeader } from "@/components/app/utility";

export function AdminPage({ selectedTenant }: { selectedTenant: TenantSummary }) {
  return (
    <div className="px-4">
      <SectionHeader title="管理" subtitle={`${selectedTenant.name} 的审核和配置`} />
      <div className="mt-3 flex flex-col gap-2">
        <ListButton title="审核稿件" description={`${selectedTenant.pendingPostCount} 条待审核`} icon={ClipboardListIcon} />
        <ListButton title="校园墙设置" description="品牌、公告、规则" icon={MegaphoneIcon} />
        <ListButton title="发布目标" description={`${selectedTenant.botAccountCount} 个 QQ 墙号`} icon={ShieldCheckIcon} />
      </div>
    </div>
  );
}
