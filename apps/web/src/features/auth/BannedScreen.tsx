import type { TenantSummary } from "@campux/domain";
import type { ActiveBan, AuthenticatedMe } from "@/types/app";
import { Button } from "@/components/ui/button";

export function BannedScreen({
  ban,
  me,
  selectedTenant,
  onLogout,
}: {
  ban: ActiveBan;
  me: AuthenticatedMe;
  selectedTenant: TenantSummary;
  onLogout: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <section className="w-full max-w-[460px] rounded-md border border-red-100 bg-white p-5 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-normal text-red-500">CAMPUX</div>
        <h1 className="mt-2 text-xl font-bold text-slate-950">账号已被封禁</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {me.user.displayName ?? me.user.qqUin} 当前不能访问 {selectedTenant.name}。
        </p>

        <dl className="mt-5 grid gap-3 rounded-md bg-red-50 p-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-red-500">封禁原因</dt>
            <dd className="mt-1 font-semibold text-red-950">{ban.comment}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-red-500">结束时间</dt>
            <dd className="mt-1 font-semibold text-red-950">{formatDateTime(ban.endsAt)}</dd>
          </div>
        </dl>

        <p className="mt-4 text-sm leading-6 text-slate-500">如需申诉，请联系当前校园墙管理员。</p>
        <Button className="mt-5 w-full font-medium" variant="outline" onClick={onLogout}>
          退出登录
        </Button>
      </section>
    </main>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
