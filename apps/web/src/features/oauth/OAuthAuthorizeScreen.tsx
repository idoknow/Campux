import { useEffect, useMemo, useState } from "react";
import type { AuthenticatedMe, OAuthAuthorizeClientResponse } from "@/types/app";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function OAuthAuthorizeScreen({
  me,
  search,
  clientResponse,
  onLogout,
  onRequireTenantSelection,
}: {
  me: AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> };
  search: string;
  clientResponse: OAuthAuthorizeClientResponse | null;
  onLogout: () => Promise<void>;
  onRequireTenantSelection: () => void;
}) {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const scope = params.get("scope") ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";
  const responseType = params.get("response_type") ?? "code";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!me.currentTenant || !me.currentMembership) {
      onRequireTenantSelection();
    }
  }, [me.currentMembership, me.currentTenant, onRequireTenantSelection]);

  async function handleDecision(decision: "approve" | "deny") {
    if (!clientId || !redirectUri) {
      setError("缺少 client_id 或 redirect_uri");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const data = await api<{ redirectUrl: string }>("/api/oauth/authorize", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          redirectUri,
          scope,
          state: state || undefined,
          codeChallenge: codeChallenge || undefined,
          codeChallengeMethod,
          responseType,
          decision,
        }),
      });
      window.location.assign(data.redirectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "授权失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-background">
      <section className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-8">
        <div className="mb-5">
          <h1 className="inline-block pr-2 text-xl font-semibold leading-tight tracking-normal text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">OAuth 授权</span>
        </div>

        <Card className="border-slate-200 bg-white shadow-none">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-slate-100 text-slate-600 shadow-none">当前校园墙：{me.currentTenant.name}</Badge>
              <Badge className="rounded-full bg-blue-50 text-blue-700 shadow-none">{me.currentMembership.role}</Badge>
            </div>

            <div className="mt-4">
              <p className="text-lg font-semibold text-slate-950">{clientResponse?.client.name ?? "正在读取应用信息"}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">此应用请求访问你的 Campux 账号。确认后会跳转到注册的回调地址。</p>
            </div>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="grid gap-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-500">应用 ID</span>
                  <span className="break-all font-mono text-xs text-slate-700">{clientResponse?.client.clientId ?? clientId}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-500">回调地址</span>
                  <span className="break-all text-right font-mono text-xs text-slate-700">{redirectUri || "未提供"}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-500">授权模式</span>
                  <span>{responseType}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-500">PKCE</span>
                  <span>{codeChallenge ? `${codeChallengeMethod}` : "未提供"}</span>
                </div>
              </div>
            </div>

            {scope ? (
              <div className="mt-4">
                <p className="text-sm font-medium text-slate-500">请求的权限</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {scope.split(/\s+/).filter(Boolean).map((item) => (
                    <Badge key={item} className="rounded-full bg-slate-100 text-slate-700 shadow-none">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {clientResponse?.client.description ? <p className="mt-4 text-sm leading-6 text-slate-600">{clientResponse.client.description}</p> : null}

            {error ? <p className="mt-4 text-sm font-medium text-red-600">{error}</p> : null}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1 font-medium" disabled={busy || !clientResponse?.settings.enabled} onClick={() => void handleDecision("approve")}>
                授权
              </Button>
              <Button className="flex-1 font-medium" variant="outline" disabled={busy} onClick={() => void handleDecision("deny")}>
                拒绝
              </Button>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-500">
              <button className="font-medium text-slate-600 underline-offset-4 hover:underline" type="button" onClick={() => void onLogout()}>
                切换账号
              </button>
              <span>{clientResponse?.settings.enabled ? "OAuth 服务已启用" : "OAuth 服务未启用"}</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
