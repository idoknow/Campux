import { useState } from "react";
import { ChevronRightIcon, LogOutIcon } from "lucide-react";
import { roleLabels } from "@/lib/app-model";
import type { AuthenticatedMe } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function TenantSelectionScreen({
  me,
  onSelectTenant,
  onOpenOps,
  onLogout,
}: {
  me: AuthenticatedMe;
  onSelectTenant: (tenantId: string) => Promise<void>;
  onOpenOps?: () => void;
  onLogout: () => Promise<void>;
}) {
  const [busyTenantId, setBusyTenantId] = useState("");

  async function select(tenantId: string) {
    setBusyTenantId(tenantId);
    try {
      await onSelectTenant(tenantId);
    } finally {
      setBusyTenantId("");
    }
  }

  return (
    <main className="min-h-dvh bg-white">
      <section className="mx-auto w-full max-w-[560px] px-4 pt-3 md:px-8 md:pt-12">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
            <span className="align-baseline text-sm text-slate-600">选择校园墙</span>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOutIcon data-icon="inline-start" />
            退出
          </Button>
        </div>

        <div className="mt-8">
          <p className="text-xl font-bold text-slate-950">{me.user.displayName ?? me.user.qqUin}</p>
          <p className="mt-2 text-sm text-slate-500">你的账号可以进入多个校园墙，请选择本次要使用的校园墙。</p>
        </div>

        <div className="mt-5 grid gap-3">
          {me.memberships.length === 0 ? (
            <Card className="bg-orange-50">
              <CardContent className="p-4 text-sm font-medium text-orange-900">暂无可访问的校园墙，请先通过对应校园墙机器人注册。</CardContent>
            </Card>
          ) : null}
          {me.memberships.map((membership) => (
            <Button
              key={membership.id}
              variant="outline"
              className="h-auto justify-between rounded-md p-4 text-left"
              disabled={busyTenantId === membership.tenant.id}
              onClick={() => void select(membership.tenant.id)}
            >
              <span>
                <span className="block font-bold">{membership.tenant.name}</span>
                <span className="text-xs text-slate-500">{roleLabels[membership.role]}</span>
              </span>
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ))}
        </div>

        {me.user.systemRole === "system_operator" && onOpenOps ? (
          <div className="mt-5 rounded-md bg-slate-100 p-4">
            <p className="font-bold">系统运维</p>
            <p className="mt-1 text-sm text-slate-500">不进入具体校园墙，直接管理所有租户信息。</p>
            <Button className="mt-3 rounded-full bg-[#42a5f5] px-5 font-bold hover:bg-[#42a5f5]" onClick={onOpenOps}>
              进入运维面板
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
