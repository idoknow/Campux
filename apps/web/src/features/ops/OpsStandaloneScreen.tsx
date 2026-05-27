import type { AuthenticatedMe } from "@/types/app";
import { Button } from "@/components/ui/button";
import { LogOutIcon } from "lucide-react";
import { ThemeModeButton } from "@/features/theme/ThemeModeControl";
import { OpsPanel } from "./OpsPanel";

export function OpsStandaloneScreen({
  me,
  onBackToTenants,
  onTenantCreated,
  onEnterTenant,
  onLogout,
}: {
  me: AuthenticatedMe;
  onBackToTenants?: () => void;
  onTenantCreated?: (() => Promise<void>) | undefined;
  onEnterTenant?: ((tenantId: string) => Promise<void>) | undefined;
  onLogout: () => void;
}) {
  const mode = me.user.systemRole === "system_operator" ? "system" : "operations";
  const title = mode === "system" ? "系统运维" : "运营管理";

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="shrink-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h1 className="inline-block pr-2 text-xl font-semibold leading-tight tracking-normal text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{title}</span>
          <p className="mt-1 truncate text-xs text-slate-500">{me.user.displayName ?? me.user.qqUin}</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeModeButton />
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-6xl">
          <OpsPanel mode={mode} onTenantCreated={onTenantCreated} onEnterTenant={onEnterTenant} />
        </div>
      </div>
    </main>
  );
}
