import type { TenantSummary } from "@campux/domain";
import type { AuthenticatedMe, MainTab } from "@/types/app";
import type { NavItem } from "@/lib/app-model";
import { roleLabels } from "@/lib/app-model";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountMenu } from "./AccountMenu";

export function DesktopSidebar({
  selectedTenant,
  me,
  navItems,
  onLogout,
  onOpenOps,
}: {
  selectedTenant: TenantSummary;
  activeTab: MainTab;
  me: AuthenticatedMe;
  navItems: NavItem[];
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
}) {
  const role = me.currentMembership?.role ?? "submitter";

  return (
    <aside className="hidden h-dvh w-[190px] shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
      <div className="border-b border-slate-200 px-4 py-4 text-base font-bold text-slate-950">Campux</div>

      <div className="flex min-h-0 flex-1 flex-col justify-between px-3 py-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent p-0">
          {navItems.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-9 justify-start rounded-full px-3 text-sm text-slate-600 shadow-none data-[state=active]:bg-blue-50 data-[state=active]:font-bold data-[state=active]:text-blue-700 data-[state=active]:shadow-none"
            >
              <span className="mr-2 text-base">{item.emoji}</span>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <AccountMenu me={me} selectedTenant={selectedTenant} roleLabel={roleLabels[role]} onLogout={onLogout} onOpenOps={onOpenOps} variant="desktop" />
      </div>
    </aside>
  );
}
