import type { TenantSummary } from "@campux/domain";
import { LogOutIcon } from "lucide-react";
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
  variant,
}: {
  selectedTenant: TenantSummary;
  me: AuthenticatedMe;
  roleLabel: string;
  onLogout: () => void;
  onOpenOps: (() => void) | undefined;
  variant: "mobile" | "desktop";
}) {
  const isDesktop = variant === "desktop";
  const displayName = me.user.displayName ?? me.user.qqUin;
  const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${me.user.qqUin}&s=100`;

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
