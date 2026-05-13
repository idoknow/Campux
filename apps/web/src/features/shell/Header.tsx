import type { TenantSummary } from "@campux/domain";
import type { AuthenticatedMe } from "@/types/app";
import { roleLabels } from "@/lib/app-model";
import { AccountMenu } from "./AccountMenu";

export function Header({
  selectedTenant,
  me,
  onLogout,
  onOpenOps,
}: {
  selectedTenant: TenantSummary;
  me: AuthenticatedMe;
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
}) {
  const role = me.currentMembership?.role ?? "submitter";
  return (
    <header className="bg-background pb-2">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{selectedTenant.name}</span>
        </div>
        <AccountMenu me={me} selectedTenant={selectedTenant} roleLabel={roleLabels[role]} onLogout={onLogout} onOpenOps={onOpenOps} variant="mobile" />
      </div>
    </header>
  );
}
