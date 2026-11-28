import { useCallback, useEffect, useRef, useState } from "react";
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
  // 加载失败或尚未加载成功时禁止编辑/保存，避免把上一个墙的残留值存到这个墙。
  const [loadFailed, setLoadFailed] = useState(false);
  /** 请求序号：丢弃切墙后到达的旧响应。 */
  const requestSeqRef = useRef(0);

  const fingerprint = [mode, smtpHost, smtpPort, smtpUser, smtpPass, fromEmail, fromName].join("\u0001");

  const load = useCallback(async () => {
    // 每次加载领一个序号：切墙后旧请求的响应必须丢弃，
    // 否则 A 墙的数据会覆盖 B 墙的表单，保存时把 A 的配置写到 B。
    requestSeqRef.current += 1;
    const seq = requestSeqRef.current;
    setLoading(true);
    setLoadFailed(false);
    // 先清空当前展示，避免在加载期间仍能编辑上一个墙的值。
    setSettings(null);
    try {
      const data = await api<RegistrationSettings>("/api/admin/registration-settings");
      if (seq !== requestSeqRef.current) return;
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
      // 测试收件人预填「裸邮箱」，不要带 "名字 <addr>" 形式的显示名。
      setTestTo(bareEmail(data.effectiveFromEmail));
      setVerifiedFingerprint(null);
    } catch (caught) {
      if (seq !== requestSeqRef.current) return;
      // 清空表单并标记失败：否则切墙后会把上一条墙的数据当成这个墙的。
      setSettings(null);
      setLoadFailed(true);
      toast.error(caught instanceof Error ? caught.message : "无法读取注册配置");
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** "Campux <a@b.com>" → "a@b.com"；取不到就原样返回。 */
  function bareEmail(value: string): string {
    const match = /<([^>]+)>/.exec(value ?? "");
    return (match?.[1] ?? value ?? "").trim();
  }

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
    setSuffixes((current) => {
      if (current.includes(suffix)) {
        return current.filter((s) => s !== suffix);
      }
      // 预设按钮也要受上限约束，否则点满后请求会被服务端拒绝。
      if (settings && current.length >= settings.maxAllowedSuffixes) {
        toast.error(`最多只能配置 ${settings.maxAllowedSuffixes} 个后缀`);
        return current;
      }
      return [...current, suffix];
    });
  }

  function addCustomSuffix() {
    // 允许 `*.` 前缀表示「放开整棵子树」，与后端 parseEmailDomainRule 保持一致。
    const raw = customSuffix.trim().toLowerCase().replace(/^[@.]/, "").replace(/\.+$/, "");
    const wildcard = raw.startsWith("*.");
    const normalized = (wildcard ? raw.slice(2) : raw);
    if (!normalized) return;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normalized)) {
      toast.error("域名格式不正确，例如 qq.com 或 *.edu.cn");
      return;
    }
    const value = wildcard ? `*.${normalized}` : normalized;
    if (suffixes.includes(value)) {
      toast.error("这个域名已经在列表里了");
      return;
    }
    if (settings && suffixes.length >= settings.maxAllowedSuffixes) {
      toast.error(`最多只能配置 ${settings.maxAllowedSuffixes} 条`);
      return;
    }
    if (wildcard) {
      const ok = window.confirm(
        `你正在放开整个 ${normalized} 域树。\n`
        + `这意味着任何 @任意前缀.${normalized} 的邮箱都能注册。\n\n`
        + `如果只想收某个具体学校/组织，请改用精确域名（如 tsinghua.${normalized}）。\n\n`
        + `确定要放开 *.${normalized} 吗？`,
      );
      if (!ok) return;
    }
    setSuffixes((current) => [...current, value]);
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
    return (
      <div className="grid gap-2">
        <p className="text-sm font-semibold text-red-600">
          {loadFailed ? "读取注册配置失败，当前不可编辑，请刷新重试。" : "注册配置不可用。"}
        </p>
        <div>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
            重新读取
          </Button>
        </div>
      </div>
    );
  }

  const officialUnavailable = mode === "official" && !settings.officialMailerAvailable;
  // 只比发件配置本身：仅调整邮箱后缀/开关时不该被迫再发一封测试邮件。
  // 与后端 mailSenderFingerprint 的口径保持一致。
  const senderFingerprint = [mode, smtpHost, smtpPort, smtpUser, smtpPass, fromEmail, fromName].join("|");
  const loadedSenderFingerprint = settings ? [
    settings.mailSender.mode,
    settings.mailSender.smtpHost,
    String(settings.mailSender.smtpPort),
    settings.mailSender.smtpUser,
    settings.mailSender.smtpPass,
    settings.mailSender.fromEmail,
    settings.mailSender.fromName,
  ].join("|") : "";
  const senderChanged = senderFingerprint !== loadedSenderFingerprint;
  const needsRetest = required && senderChanged && verifiedFingerprint !== fingerprint;

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
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">允许的邮箱域名</p>
            <Badge variant="outline" className="shrink-0">
              {suffixes.length === 0 ? "不限制" : `已选 ${suffixes.length} 条`}
            </Badge>
          </div>
          <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs font-semibold leading-5 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            不勾选任何条目 = <strong>不限制邮箱域名</strong>，任意合法邮箱都能注册。
            <br />
            下面的条目默认<strong>精确匹配</strong>：勾 <code>qq.com</code> 只接受 <code>@qq.com</code>，
            不含任何子域。
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
            {suffixes.filter((s) => !settings.commonSuffixes.includes(s) && !(settings.commonWildcardDomains ?? []).some((d) => s === `*.${d}`)).map((suffix) => (
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

          {/* 通配域树：单独一组，明确「放开整棵树」。 */}
          {(settings.commonWildcardDomains ?? []).length > 0 ? (
            <div className="grid gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                开放整棵域树（谨慎使用）
              </p>
              <p className="text-xs font-semibold leading-5 text-rose-700 dark:text-rose-300">
                勾选下面任一项，会放开该域及其<strong>所有子域</strong>。
                例如勾 <code>*.edu.cn</code> 后，任何 <code>@任意前缀.edu.cn</code> 都能注册——
                其中并不只有学校。若只想收本校，请改用自定义输入填完整域名，
                如 <code>tsinghua.edu.cn</code>（精确）。确需其下级时才写 <code>*.tsinghua.edu.cn</code>。
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(settings.commonWildcardDomains ?? []).map((domain) => {
                  const value = `*.${domain}`;
                  const active = suffixes.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={busy || saving}
                      onClick={() => toggleSuffix(value)}
                      className={`rounded-full px-2.5 py-1 text-xs font-bold transition ${
                        active
                          ? "bg-rose-600 text-white"
                          : "bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900"
                      }`}
                    >
                      *.{domain}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={customSuffix}
              className="h-9 max-w-56"
              placeholder="如 tsinghua.edu.cn 或 *.edu.cn"
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
              添加域名
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
