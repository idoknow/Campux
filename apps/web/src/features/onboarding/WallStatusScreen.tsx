import { ArchiveIcon, Clock3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WallStatusScreen({
  variant,
  wallName,
  onBackToTenants,
  onLogout,
}: {
  variant: "pending" | "archived";
  wallName: string;
  onBackToTenants?: (() => void) | undefined;
  onLogout: () => void;
}) {
  const pending = variant === "pending";
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <div className={`mx-auto grid size-12 place-items-center rounded-full ring-1 ${pending ? "bg-amber-50 text-amber-600 ring-amber-200" : "bg-slate-100 text-slate-500 ring-slate-200"}`}>
          {pending ? <Clock3Icon className="size-6" /> : <ArchiveIcon className="size-6" />}
        </div>
        <h1 className="mt-4 text-lg font-black text-slate-900 dark:text-slate-50">{wallName}</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {pending ? "校园墙还在开通中，墙号机器人接入后即可使用。" : "校园墙已存档，暂时无法访问。如需恢复请联系系统运维。"}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {onBackToTenants ? (
            <Button variant="outline" onClick={onBackToTenants}>切换校园墙</Button>
          ) : null}
          <Button variant="ghost" onClick={onLogout}>退出登录</Button>
        </div>
      </div>
    </div>
  );
}
