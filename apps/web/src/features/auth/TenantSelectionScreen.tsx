import { useState } from "react";
import { ChevronRightIcon, LogOutIcon } from "lucide-react";
import { roleLabels } from "@/lib/app-model";
import { getTenantSelectionOptions } from "./tenant-selection-options";
import type { AuthenticatedMe } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeModeButton } from "@/features/theme/ThemeModeControl";

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
  const tenantOptions = getTenantSelectionOptions(me);

  async function select(tenantId: string) {
    setBusyTenantId(tenantId);
    try {
      await onSelectTenant(tenantId);
    } finally {
      setBusyTenantId("");
    }
  }

  const opsTitle = me.user.systemRole === "system_operator" ? "系统运维" : "运营管理";
  const opsDescription =
    me.user.systemRole === "system_operator"
      ? "不进入具体校园墙，直接管理所有校园墙。"
      : "创建和管理你负责的校园墙，只展示你所属墙的运营信息。";
  const opsButton = me.user.systemRole === "system_operator" ? "进入运维面板" : "进入运营面板";

  return (
    <main className="min-h-dvh bg-background">
      <section className="mx-auto w-full max-w-[560px] px-4 pt-3 md:px-8 md:pt-12">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="inline-block pr-2 text-xl font-semibold leading-tight tracking-normal text-slate-950">Campux</h1>
            <span className="align-baseline text-sm text-slate-600">选择校园墙</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeModeButton />
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOutIcon data-icon="inline-start" />
              退出
            </Button>
          </div>
        </div>

        <div className="mt-8">
          <p className="text-lg font-semibold text-slate-950">{me.user.displayName ?? me.user.qqUin}</p>
          <p className="mt-2 text-sm text-slate-500">你的账号可以进入多个校园墙，请选择本次要使用的校园墙。</p>
        </div>

        <div className="mt-5 grid gap-3">
          {tenantOptions.length === 0 ? (
            <Card className="bg-orange-50">
              <CardContent className="p-4 text-sm font-medium text-orange-900">暂无可访问的校园墙，请先通过对应校园墙机器人注册。</CardContent>
            </Card>
          ) : null}
          {tenantOptions.map((option) => (
            <Button
              key={option.key}
              variant="outline"
              className="h-auto justify-between rounded-md bg-white p-4 text-left"
              disabled={busyTenantId === option.tenantId}
              onClick={() => void select(option.tenantId)}
            >
              <span>
                <span className="block font-bold">{option.tenant.name}</span>
                <span className="text-xs text-slate-500">{option.syntheticSystemAccess ? "系统运维 · 管理员身份" : roleLabels[option.role]}</span>
              </span>
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ))}
        </div>

        {onOpenOps ? (
          <div className="product-surface mt-5 p-4">
            <p className="font-semibold">{opsTitle}</p>
            <p className="mt-1 text-sm text-slate-500">{opsDescription}</p>
            <Button className="mt-3 px-5 font-medium" onClick={onOpenOps}>
              {opsButton}
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
