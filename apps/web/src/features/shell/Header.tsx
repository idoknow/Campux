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
    <header className="border-b border-slate-200 bg-white md:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="min-w-0 leading-none">
          <h1 className="inline-block pr-2 text-lg font-bold leading-none tracking-normal text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-500">{selectedTenant.name}</span>
        </div>
        <AccountMenu me={me} selectedTenant={selectedTenant} roleLabel={roleLabels[role]} onLogout={onLogout} onOpenOps={onOpenOps} variant="mobile" />
      </div>
    </header>
  );
}
