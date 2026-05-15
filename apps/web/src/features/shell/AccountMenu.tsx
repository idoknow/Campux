import type { TenantSummary } from "@campux/domain";
import { CheckIcon, LogOutIcon, ShuffleIcon } from "lucide-react";
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
  const switchableMemberships = me.memberships.filter((membership) => membership.tenant.status === "active" || membership.tenant.id === selectedTenant.id);
  const canSwitchTenant = !me.hostLocked && switchableMemberships.length > 1;

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
            {switchableMemberships.map((membership) => (
              <DropdownMenuItem
                key={membership.id}
                disabled={membership.tenant.id === selectedTenant.id}
                onSelect={() => {
                  if (membership.tenant.id !== selectedTenant.id) {
                    void onSelectTenant(membership.tenant.id);
                  }
                }}
              >
                {membership.tenant.id === selectedTenant.id ? <CheckIcon data-icon="inline-start" /> : <span className="w-4" />}
                <span className="min-w-0 flex-1 truncate">{membership.tenant.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {onOpenOps ? (
          <>
            <DropdownMenuItem onSelect={onOpenOps}>系统运维</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOutIcon data-icon="inline-start" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
