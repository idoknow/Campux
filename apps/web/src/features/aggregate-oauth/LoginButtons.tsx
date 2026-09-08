import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AggregateLoginIcon, AGGREGATE_LOGIN_TYPE_COLORS, AGGREGATE_LOGIN_TYPE_LABELS } from "./icons";

interface AggregateLoginConfig {
  enabled: boolean;
  loginTypes: string[];
}

/**
 * 登录页的聚合登录按钮区。
 * 读取当前校园墙的 /api/public/aggregate-login/config（无需登录），
 * 只渲染已启用且勾选的登录方式；点击后向服务端换授权跳转地址并跳转。
 */
export function AggregateLoginButtons({ returnTo }: { returnTo?: string }) {
  const [config, setConfig] = useState<AggregateLoginConfig | null>(null);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    api<AggregateLoginConfig>("/api/public/aggregate-login/config")
      .then((data) => {
        if (mounted) setConfig(data);
      })
      .catch(() => {
        // 未开启或不可用时静默隐藏，不打扰主登录流程。
        if (mounted) setConfig({ enabled: false, loginTypes: [] });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const enabled = config?.enabled === true && (config?.loginTypes?.length ?? 0) > 0;
  if (!enabled) {
    return null;
  }

  async function start(type: string) {
    setBusyType(type);
    setError("");
    try {
      const params = new URLSearchParams({ type });
      if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        params.set("returnTo", returnTo);
      }
      const data = await api<{ url: string }>(`/api/auth/aggregate-login/login-url?${params.toString()}`);
      window.location.href = data.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "第三方登录暂不可用");
      setBusyType(null);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs text-slate-400">其他登录方式</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {config.loginTypes.map((type) => {
          const loading = busyType === type;
          return (
            <button
              key={type}
              type="button"
              disabled={busyType !== null}
              onClick={() => void start(type)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              title={AGGREGATE_LOGIN_TYPE_LABELS[type as keyof typeof AGGREGATE_LOGIN_TYPE_LABELS] ?? type}
            >
              <span className="h-3.5 w-3.5" style={{ color: AGGREGATE_LOGIN_TYPE_COLORS[type as keyof typeof AGGREGATE_LOGIN_TYPE_COLORS] }}>
                <AggregateLoginIcon type={type} className="h-full w-full" />
              </span>
              {loading ? "跳转中" : (AGGREGATE_LOGIN_TYPE_LABELS[type as keyof typeof AGGREGATE_LOGIN_TYPE_LABELS] ?? type)}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-center text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  );
}