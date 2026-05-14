import type { AuthenticatedMe } from "@/types/app";
import { Button } from "@/components/ui/button";
import { LogOutIcon } from "lucide-react";
import { OpsPanel } from "./OpsPanel";

export function OpsStandaloneScreen({
  me,
  onBackToTenants,
  onLogout,
}: {
  me: AuthenticatedMe;
  onBackToTenants?: () => void;
  onLogout: () => void;
}) {
  return (
    <main className="min-h-dvh bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h1 className="inline-block pr-2 text-xl font-semibold leading-tight tracking-normal text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">系统运维</span>
          <p className="mt-1 truncate text-xs text-slate-500">{me.user.displayName ?? me.user.qqUin}</p>
        </div>
        <div className="flex items-center gap-2">
          {onBackToTenants ? (
            <Button variant="outline" size="sm" onClick={onBackToTenants}>
              选择校园墙
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOutIcon data-icon="inline-start" />
            退出
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-6xl py-4">
        <OpsPanel />
      </div>
    </main>
  );
}
