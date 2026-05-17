import type { TenantSummary } from "@campux/domain";
import type { AuthenticatedMe } from "@/types/app";
import { roleLabels } from "@/lib/app-model";
import { AccountMenu } from "./AccountMenu";

export function Header({
  selectedTenant,
  me,
  onLogout,
  onOpenOps,
  onSelectTenant,
}: {
  selectedTenant: TenantSummary;
  me: AuthenticatedMe;
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
  onSelectTenant: (tenantId: string) => Promise<void>;
}) {
  const role = me.currentMembership?.role ?? "submitter";
  const logoUrl = selectedTenant.logoUrl?.trim() || "/logo.svg";
  return (
    <header className="border-b border-slate-200 bg-white md:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2 leading-none">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
            <img src={logoUrl} alt={`${selectedTenant.name} logo`} className="h-full w-full object-contain p-1.5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-none tracking-normal text-slate-950">Campux</h1>
            <span className="block truncate text-sm text-slate-500">{selectedTenant.name}</span>
          </div>
        </div>
        <AccountMenu me={me} selectedTenant={selectedTenant} roleLabel={roleLabels[role]} onLogout={onLogout} onOpenOps={onOpenOps} onSelectTenant={onSelectTenant} variant="mobile" />
      </div>
    </header>
  );
}
