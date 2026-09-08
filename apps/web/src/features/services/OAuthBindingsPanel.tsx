import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2Icon, UnlinkIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AggregateLoginIcon, AGGREGATE_LOGIN_TYPE_COLORS, AGGREGATE_LOGIN_TYPE_LABELS } from "@/features/aggregate-oauth/icons";

interface BoundIdentity {
  provider: string;
  name: string | null;
  createdAt: string;
}

/**
 * 租户服务页「第三方登录」绑定面板。
 * 展示当前账号已绑定的第三方身份，可发起新的绑定（跳转聚合授权，回调后由服务端完成绑定）、解绑已绑定身份。
 */
export function OAuthBindingsPanel({ onDone }: { onDone?: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [identities, setIdentities] = useState<BoundIdentity[]>([]);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBound = useCallback(async () => {
    try {
      const data = await api<{ identities: BoundIdentity[] }>("/api/auth/aggregate-login/identities");
      setIdentities(data.identities);
    } catch {
      // 面板已加载；identities 拉取失败只保留空列表即可，不阻断绑定发起。
      setIdentities([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    api<{ enabled: boolean; loginTypes: string[] }>("/api/public/aggregate-login/config")
      .then((data) => {
        if (mounted) {
          setEnabled(data.enabled);
          setAllowedTypes(data.loginTypes ?? []);
        }
      })
      .catch(() => {
        if (mounted) setEnabled(false);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    void loadBound();
    return () => {
      mounted = false;
    };
  }, [loadBound]);

  async function startBind(type: string) {
    setBusyType(type);
    try {
      const params = new URLSearchParams({ type });
      // 绑定成功回调会 302 回退到这个路径（避免整页变成 JSON），再刷新列表。
      const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/services";
      params.set("returnTo", returnTo);
      const data = await api<{ url: string }>(`/api/auth/aggregate-login/login-url?${params.toString()}`);
      window.location.href = data.url;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "发起绑定失败");
      setBusyType(null);
    }
  }

  async function unbind(type: string) {
    setBusyType(type);
    try {
      await api<{ ok: true }>("/api/auth/aggregate-login/unbind", {
        method: "POST",
        body: JSON.stringify({ type }),
      });
      await loadBound();
      toast.success("已解除绑定");
      onDone?.();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "解绑失败");
    } finally {
      setBusyType(null);
    }
  }

  const label = (t: string) =>
    (AGGREGATE_LOGIN_TYPE_LABELS[t as keyof typeof AGGREGATE_LOGIN_TYPE_LABELS] ??
      t.replace(/^aggregate:/, ""));
  const color = (t: string) => AGGREGATE_LOGIN_TYPE_COLORS[t as keyof typeof AGGREGATE_LOGIN_TYPE_COLORS];

  return (
    <section className="product-surface mt-4 p-4">
      <div className="flex items-center gap-2">
        <Link2Icon className="size-5 text-slate-500" />
        <p className="text-base font-semibold">第三方登录</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        绑定下方任一平台后，就可从登录页用该身份一键登录；也可以在登录页用该身份直接登录本校园墙。
      </p>

      {loading ? <p className="mt-4 text-sm text-slate-400">加载中...</p> : null}

      {!loading && enabled === false ? (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
          当前校园墙未开启第三方登录，请联系管理员在「插件」中启用。
        </p>
      ) : null}

      {!loading && enabled === true ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {allowedTypes.length === 0 ? (
              <p className="text-sm text-slate-400">没有可绑定/可登录的第三方平台。</p>
            ) : (
              allowedTypes.map((type) => {
                const bound = identities.some((item) => item.provider === type);
                const busy = busyType === type;
                return (
                  <div
                    key={type}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
                    style={{ color: "#0f172a" }}
                  >
                    <span className="h-3.5 w-3.5" style={{ color: color(type) }}>
                      <AggregateLoginIcon type={type} className="h-full w-full" />
                    </span>
                    <span>{label(type)}</span>
                    {bound ? (
                      <Button size="sm" variant="outline" className="h-6 px-1.5 text-xs" disabled={busyType !== null} onClick={() => void unbind(type)}>
                        {busy ? "处理中" : <UnlinkIcon className="size-3" />}
                        <span className="ml-1">解绑</span>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-6 px-1.5 text-xs" disabled={busyType !== null} onClick={() => void startBind(type)}>
                        {busy ? "跳转中" : "绑定"}
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">绑定后可在本校园墙登录页直接使用对应平台扫码登录。</p>
        </>
      ) : null}
    </section>
  );
}