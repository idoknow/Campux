import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, LoaderIcon, MailIcon, SendIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { RegistrationSettings } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * 「注册与邮箱验证」配置面板。
 *
 * 两条硬规则在服务端强制，这里同步给出即时反馈：
 * 1. 开启邮箱验证 = 发件配置必须完整；
 * 2. 改过发件配置 = 必须先发测试邮件成功，才能保存。
 */
export function RegistrationSettingsPanel({ tenantId, busy }: { tenantId: string; busy: boolean }) {
  const [settings, setSettings] = useState<RegistrationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [required, setRequired] = useState(false);
  const [suffixes, setSuffixes] = useState<string[]>([]);
  const [customSuffix, setCustomSuffix] = useState("");
  const [mode, setMode] = useState<"official" | "smtp">("official");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [testTo, setTestTo] = useState("");
  // 测试通过后记录当时的配置指纹；任何字段再变化就要求重测。
  const [verifiedFingerprint, setVerifiedFingerprint] = useState<string | null>(null);

  const fingerprint = [mode, smtpHost, smtpPort, smtpUser, smtpPass, fromEmail, fromName].join("\u0001");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<RegistrationSettings>("/api/admin/registration-settings");
      setSettings(data);
      setRequired(data.emailPolicy.required);
      setSuffixes(data.emailPolicy.allowedSuffixes);
      setMode(data.mailSender.mode);
      setSmtpHost(data.mailSender.smtpHost);
      setSmtpPort(String(data.mailSender.smtpPort));
      setSmtpUser(data.mailSender.smtpUser);
      setSmtpPass(data.mailSender.smtpPass);
      setFromEmail(data.mailSender.fromEmail);
      setFromName(data.mailSender.fromName);
      setTestTo(data.effectiveFromEmail || "");
      setVerifiedFingerprint(null);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "无法读取注册配置");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tenantId]);

  const senderPayload = {
    mode,
    smtpHost,
    smtpPort: Number(smtpPort) || 465,
    smtpUser,
    smtpPass,
    fromEmail,
    fromName,
  };

  async function sendTestMail() {
    if (!testTo.trim()) {
      toast.error("请填写接收测试邮件的邮箱");
      return;
    }
    setTesting(true);
    try {
      await api("/api/admin/registration-settings/test-mail", {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim(), mailSender: senderPayload }),
      });
      setVerifiedFingerprint(fingerprint);
      toast.success(`测试邮件已发送到 ${testTo.trim()}，请确认收到后再保存。`);
    } catch (caught) {
      setVerifiedFingerprint(null);
      toast.error(caught instanceof Error ? caught.message : "测试邮件发送失败");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/admin/registration-settings", {
        method: "PATCH",
        body: JSON.stringify({
          emailPolicy: { required, allowedSuffixes: suffixes },
          mailSender: senderPayload,
        }),
      });
      toast.success("注册与邮箱验证设置已保存。");
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleSuffix(suffix: string) {
    setSuffixes((current) => (current.includes(suffix) ? current.filter((s) => s !== suffix) : [...current, suffix]));
  }

  function addCustomSuffix() {
    const normalized = customSuffix.trim().toLowerCase().replace(/^[@.]+/, "");
    if (!normalized) return;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normalized)) {
      toast.error("后缀格式不正确，例如 qq.com");
      return;
    }
    if (suffixes.includes(normalized)) {
      toast.error("这个后缀已经在列表里了");
      return;
    }
    if (settings && suffixes.length >= settings.maxAllowedSuffixes) {
      toast.error(`最多只能配置 ${settings.maxAllowedSuffixes} 个后缀`);
      return;
    }
    setSuffixes((current) => [...current, normalized]);
    setCustomSuffix("");
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
        <LoaderIcon className="size-4 animate-spin" />
        正在读取注册配置…
      </div>
    );
  }
  if (!settings) {
    return <p className="text-sm font-semibold text-red-600">读取注册配置失败，请刷新重试。</p>;
  }

  const officialUnavailable = mode === "official" && !settings.officialMailerAvailable;
  const needsRetest = required && verifiedFingerprint !== fingerprint;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
        <label className="flex cursor-pointer items-start gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={required}
            disabled={busy || saving}
            onChange={(event) => setRequired(event.target.checked)}
          />
          <span>
            网页注册要求邮箱验证码
            <span className="mt-0.5 block text-xs font-semibold text-slate-500">
              开启后，同学在登录页注册时必须填邮箱并收验证码；关闭则只需 QQ 号、用户名和密码。
              机器人建号与运营管理员注册不受此开关影响。
            </span>
          </span>
        </label>
      </div>

      {required ? (
        <div className="grid gap-3 rounded-md border border-slate-200 px-3 py-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">允许的邮箱后缀</p>
            <Badge variant="outline" className="shrink-0">
              {suffixes.length === 0 ? "不限制后缀" : `已选 ${suffixes.length} 个`}
            </Badge>
          </div>
          <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs font-semibold leading-5 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            不勾选任何后缀 = <strong>不限制邮箱后缀</strong>，任意合法邮箱都能注册。
            只勾选需要的后缀则会拒绝其他域名（如只勾 <code>@qq.com</code> 就只接受 QQ 邮箱）。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {settings.commonSuffixes.map((suffix) => {
              const active = suffixes.includes(suffix);
              return (
                <button
                  key={suffix}
                  type="button"
                  disabled={busy || saving}
                  onClick={() => toggleSuffix(suffix)}
                  className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${
                    active
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  @{suffix}
                </button>
              );
            })}
            {/* 自定义后缀（不在常用列表里的）也要能取消。 */}
            {suffixes.filter((s) => !settings.commonSuffixes.includes(s)).map((suffix) => (
              <button
                key={suffix}
                type="button"
                disabled={busy || saving}
                onClick={() => toggleSuffix(suffix)}
                className="rounded-full bg-sky-600 px-2.5 py-1 text-xs font-bold text-white"
                title="点击移除"
              >
                @{suffix} ×
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={customSuffix}
              className="h-9 max-w-56"
              placeholder="自定义后缀，如 edu.cn"
              disabled={busy || saving}
              onChange={(event) => setCustomSuffix(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustomSuffix();
                }
              }}
            />
            <Button variant="outline" size="sm" className="h-9" disabled={busy || saving} onClick={addCustomSuffix}>
              添加后缀
            </Button>
            {suffixes.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-slate-500"
                disabled={busy || saving}
                onClick={() => setSuffixes([])}
              >
                清空（改为不限制）
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-md border border-slate-200 px-3 py-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
            <MailIcon className="size-4" />
            发件服务
          </p>
          {verifiedFingerprint === fingerprint ? (
            <Badge className="shrink-0 bg-green-50 text-green-700 ring-1 ring-green-200">
              <CheckCircle2Icon className="mr-1 size-3" />
              已验证
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 text-slate-500">
              未验证
            </Badge>
          )}
        </div>

        <Select value={mode} onValueChange={(value) => setMode(value as "official" | "smtp")} disabled={busy || saving}>
          <SelectTrigger className="h-10 w-full bg-white font-bold dark:bg-slate-950">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="official">官方发件（推荐，无需配置）</SelectItem>
            <SelectItem value="smtp">自定义 SMTP</SelectItem>
          </SelectContent>
        </Select>

        {mode === "official" ? (
          <div className="grid gap-1.5">
            <p className="text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">
              使用平台自带的发件服务，发件人 <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{settings.officialFromEmail}</code>，
              与运营管理员注册用的是同一套。
            </p>
            {officialUnavailable ? (
              <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs font-bold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                本实例没有配置官方发件（RESEND_API_KEY）。自托管部署请改用「自定义 SMTP」。
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              SMTP 服务器
              <Input
                className="h-9"
                value={smtpHost}
                placeholder="smtp.qq.com"
                disabled={busy || saving}
                onChange={(event) => setSmtpHost(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              端口
              <Input
                className="h-9"
                inputMode="numeric"
                value={smtpPort}
                placeholder="465"
                disabled={busy || saving}
                onChange={(event) => setSmtpPort(event.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              SMTP 账号
              <Input
                className="h-9"
                value={smtpUser}
                placeholder="noreply@qq.com"
                disabled={busy || saving}
                onChange={(event) => setSmtpUser(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              密码 / 授权码
              <Input
                className="h-9"
                type="password"
                value={smtpPass}
                placeholder="QQ/163 邮箱需用授权码"
                disabled={busy || saving}
                onChange={(event) => setSmtpPass(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              发件人邮箱
              <Input
                className="h-9"
                value={fromEmail}
                placeholder="noreply@qq.com"
                disabled={busy || saving}
                onChange={(event) => setFromEmail(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
              发件人显示名
              <Input
                className="h-9"
                value={fromName}
                placeholder="Campux 校园墙"
                disabled={busy || saving}
                onChange={(event) => setFromName(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <label className="grid min-w-48 flex-1 gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
            发送测试邮件到
            <Input
              className="h-9"
              value={testTo}
              placeholder="收件邮箱"
              disabled={busy || testing}
              onChange={(event) => setTestTo(event.target.value)}
            />
          </label>
          <Button variant="outline" className="h-9" disabled={busy || testing || officialUnavailable} onClick={() => void sendTestMail()}>
            {testing ? <LoaderIcon className="mr-1 size-4 animate-spin" /> : <SendIcon className="mr-1 size-4" />}
            发送测试邮件
          </Button>
        </div>
        {required ? (
          <p className={`text-xs font-bold ${needsRetest ? "text-amber-700 dark:text-amber-300" : "text-green-700 dark:text-green-300"}`}>
            {needsRetest
              ? "开启邮箱验证需要先发送测试邮件并确认收到，之后才能保存。"
              : "发件配置已验证，可以保存。"}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button disabled={busy || saving || (required && needsRetest)} onClick={() => void save()}>
          {saving ? <LoaderIcon className="mr-1 size-4 animate-spin" /> : null}
          保存注册设置
        </Button>
      </div>
    </div>
  );
}
