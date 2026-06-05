import type { TenantSummary } from "@campux/domain";
import { CheckIcon, LogOutIcon, ShuffleIcon } from "lucide-react";
import { getTenantSelectionOptions } from "@/features/auth/tenant-selection-options";
import type { AuthenticatedMe } from "@/types/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeMenuItems } from "@/features/theme/ThemeModeControl";

export function AccountMenu({
  selectedTenant,
  me,
  roleLabel,
  onLogout,
  onOpenOps,
  onSelectTenant,
  variant,
}: {
  selectedTenant: TenantSummary;
  me: AuthenticatedMe;
  roleLabel: string;
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
  onSelectTenant: (tenantId: string) => Promise<void>;
  variant: "mobile" | "desktop";
}) {
  const isDesktop = variant === "desktop";
  const displayName = me.user.displayName ?? me.user.qqUin;
  const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${me.user.qqUin}&s=100`;
  const switchableTenants = getTenantSelectionOptions(me).filter(
    (option) => option.tenant.status === "active" || option.tenantId === selectedTenant.id,
  );
  const canSwitchTenant = !me.hostLocked && switchableTenants.length > 1;
  const opsMenuLabel = me.user.systemRole === "operations_admin" ? "运营管理" : "系统运维";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={
            isDesktop
              ? "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50"
              : "flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white"
          }
          aria-label="账户菜单"
        >
          <Avatar className={isDesktop ? "h-9 w-9" : "h-7 w-7"}>
            <AvatarImage src={avatarUrl} alt="用户头像" />
            <AvatarFallback>QQ</AvatarFallback>
          </Avatar>
          {isDesktop ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-slate-500">{roleLabel}</p>
            </div>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isDesktop ? "start" : "end"} className="w-52">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-slate-900">{displayName}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {selectedTenant.name} · {roleLabel}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {me.hostLocked ? (
          <>
            <DropdownMenuLabel className="text-xs font-medium leading-relaxed text-slate-500">
              当前域名已绑定到 {selectedTenant.name}，此入口不会切换到其他校园墙。
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : canSwitchTenant ? (
          <>
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <ShuffleIcon className="size-3.5" />
              切换校园墙
            </DropdownMenuLabel>
            <div className="max-h-60 overflow-y-auto">
              {switchableTenants.map((option) => (
                <DropdownMenuItem
                  key={option.key}
                  disabled={option.tenantId === selectedTenant.id}
                  onSelect={() => {
                    if (option.tenantId !== selectedTenant.id) {
                      void onSelectTenant(option.tenantId);
                    }
                  }}
                >
                  {option.tenantId === selectedTenant.id ? <CheckIcon data-icon="inline-start" /> : <span className="w-4" />}
                  <span className="min-w-0 flex-1 truncate">{option.tenant.name}</span>
                  {option.syntheticSystemAccess ? <span className="shrink-0 text-xs text-slate-400">运维</span> : null}
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {onOpenOps ? (
          <>
            <DropdownMenuItem onSelect={onOpenOps}>{opsMenuLabel}</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOutIcon data-icon="inline-start" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
