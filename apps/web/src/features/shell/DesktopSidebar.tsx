import { useEffect, useRef, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import type { AuthenticatedMe, MainTab } from "@/types/app";
import type { NavItem } from "@/lib/app-model";
import { roleLabels } from "@/lib/app-model";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountMenu } from "./AccountMenu";

const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_WIDTH_KEY = "campux.sidebar-width";

function readSidebarWidth(): number {
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(saved) && saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH ? saved : 190;
}

export function DesktopSidebar({
  selectedTenant,
  me,
  navItems,
  onLogout,
  onOpenOps,
  onSelectTenant,
}: {
  selectedTenant: TenantSummary;
  activeTab: MainTab;
  me: AuthenticatedMe;
  navItems: NavItem[];
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
  onSelectTenant: (tenantId: string) => Promise<void>;
}) {
  const role = me.currentMembership?.role ?? "submitter";
  const logoUrl = selectedTenant.logoUrl?.trim() || "/logo.svg";
  const [width, setWidth] = useState<number>(readSidebarWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [width]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const next = dragRef.current.startWidth + (event.clientX - dragRef.current.startX);
    setWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, next)));
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <aside className="relative hidden h-dvh shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col" style={{ width }}>
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <img src={logoUrl} alt={`${selectedTenant.name} logo`} className="h-full w-full object-contain p-1.5" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">Campux</div>
            <div className="mt-1 truncate text-base font-bold text-slate-950" title={selectedTenant.name}>
              {selectedTenant.name}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-between px-3 py-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent p-0">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="h-9 justify-start rounded-full px-3 text-sm text-slate-600 shadow-none data-[state=active]:bg-blue-50 data-[state=active]:font-bold data-[state=active]:text-blue-700 data-[state=active]:shadow-none"
              >
                <Icon className="mr-2 size-4.5" strokeWidth={2.1} />
                <span className="min-w-0 truncate">{item.label}</span>
                {item.badge ? (
                  <span className="ml-auto rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-black leading-none text-amber-700 ring-1 ring-amber-200">
                    {item.badge}
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <AccountMenu me={me} selectedTenant={selectedTenant} roleLabel={roleLabels[role]} onLogout={onLogout} onOpenOps={onOpenOps} onSelectTenant={onSelectTenant} variant="desktop" />
      </div>
      {/* 右缘拖拽句柄：拖宽/拖窄侧边栏，宽度限制在 [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH] */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="拖动调整侧边栏宽度"
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none hover:bg-slate-200/80 active:bg-slate-300/80"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      />
    </aside>
  );
}
