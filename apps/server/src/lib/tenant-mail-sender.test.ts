import { describe, expect, it } from "bun:test";
import type { CampuxConfig } from "@campux/config";
import {
  SMTP_PASS_MASK,
  maskMailSenderConfig,
  normalizeMailSenderConfig,
  resolveEffectiveFromEmail,
  restoreMaskedSmtpPass,
  tenantMailSenderDefaults,
  validateMailSenderConfig,
  validateSmtpHostTarget,
} from "./tenant-mail-sender";

const configWithOfficial = { resend: { apiKey: "re_test", fromEmail: "Campux <noreply@campux.top>" } } as unknown as CampuxConfig;
const configWithoutOfficial = { resend: { apiKey: "", fromEmail: "Campux <noreply@campux.top>" } } as unknown as CampuxConfig;

describe("normalizeMailSenderConfig", () => {
  it("defaults to official mode", () => {
    expect(normalizeMailSenderConfig(null)).toEqual(tenantMailSenderDefaults);
    expect(tenantMailSenderDefaults.mode).toBe("official");
  });

  it("clamps port and trims strings", () => {
    const normalized = normalizeMailSenderConfig({
      mode: "smtp",
      smtpHost: "  smtp.qq.com ",
      smtpPort: 99999,
      smtpUser: " a@qq.com ",
      fromEmail: " a@qq.com ",
    });
    expect(normalized.smtpHost).toBe("smtp.qq.com");
    expect(normalized.smtpPort).toBe(465);
    expect(normalized.smtpUser).toBe("a@qq.com");
    expect(normalized.fromEmail).toBe("a@qq.com");
  });

  it("falls back to official for unknown modes", () => {
    expect(normalizeMailSenderConfig({ mode: "weird" }).mode).toBe("official");
  });
});

describe("validateSmtpHostTarget", () => {
  it("rejects loopback and link-local targets", () => {
    expect(validateSmtpHostTarget("127.0.0.1").ok).toBe(false);
    expect(validateSmtpHostTarget("127.1.2.3").ok).toBe(false);
    expect(validateSmtpHostTarget("169.254.169.254").ok).toBe(false);
    expect(validateSmtpHostTarget("localhost").ok).toBe(false);
    expect(validateSmtpHostTarget("::1").ok).toBe(false);
    expect(validateSmtpHostTarget("fe80::1").ok).toBe(false);
    expect(validateSmtpHostTarget("0.0.0.0").ok).toBe(false);
  });

  it("allows public hosts and private LAN relays used by self-hosters", () => {
    expect(validateSmtpHostTarget("smtp.qq.com").ok).toBe(true);
    expect(validateSmtpHostTarget("192.168.1.10").ok).toBe(true);
    expect(validateSmtpHostTarget("10.0.0.5").ok).toBe(true);
    expect(validateSmtpHostTarget("172.16.3.4").ok).toBe(true);
  });

  it("rejects an empty host", () => {
    expect(validateSmtpHostTarget("   ").ok).toBe(false);
  });
});

describe("validateMailSenderConfig", () => {
  it("requires official mailer to be enabled in official mode", () => {
    const official = { ...tenantMailSenderDefaults, mode: "official" as const };
    expect(validateMailSenderConfig(official, configWithOfficial).ok).toBe(true);
    const blocked = validateMailSenderConfig(official, configWithoutOfficial);
    expect(blocked.ok).toBe(false);
    expect(blocked.problems[0]).toContain("RESEND_API_KEY");
  });

  it("lists every missing smtp field", () => {
    const smtp = { ...tenantMailSenderDefaults, mode: "smtp" as const };
    const result = validateMailSenderConfig(smtp, configWithOfficial);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThanOrEqual(4);
  });

  it("accepts a complete smtp config", () => {
    const smtp = {
      mode: "smtp" as const,
      smtpHost: "smtp.qq.com",
      smtpPort: 465,
      smtpUser: "a@qq.com",
      smtpPass: "secret",
      fromEmail: "a@qq.com",
      fromName: "wall",
    };
    expect(validateMailSenderConfig(smtp, configWithoutOfficial).ok).toBe(true);
  });
});

describe("maskMailSenderConfig / restoreMaskedSmtpPass", () => {
  const stored = {
    mode: "smtp" as const,
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    smtpUser: "a@qq.com",
    smtpPass: "real-secret",
    fromEmail: "a@qq.com",
    fromName: "wall",
  };

  it("masks the password on read", () => {
    expect(maskMailSenderConfig(stored).smtpPass).toBe(SMTP_PASS_MASK);
    expect(maskMailSenderConfig({ ...stored, smtpPass: "" }).smtpPass).toBe("");
  });

  it("restores stored password when connection info is unchanged", () => {
    const submitted = { ...stored, smtpPass: SMTP_PASS_MASK };
    const result = restoreMaskedSmtpPass(submitted, stored);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.smtpPass).toBe("real-secret");
  });

  it("refuses to reuse the stored password against a different server", () => {
    const submitted = { ...stored, smtpHost: "smtp.evil.com", smtpPass: SMTP_PASS_MASK };
    const result = restoreMaskedSmtpPass(submitted, stored);
    expect(result.ok).toBe(false);
  });

  it("keeps a freshly typed password", () => {
    const submitted = { ...stored, smtpPass: "new-secret" };
    const result = restoreMaskedSmtpPass(submitted, stored);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.smtpPass).toBe("new-secret");
  });
});

describe("resolveEffectiveFromEmail", () => {
  it("uses official address in official mode and own address in smtp mode", () => {
    expect(resolveEffectiveFromEmail({ ...tenantMailSenderDefaults, mode: "official" }, configWithOfficial))
      .toBe("Campux <noreply@campux.top>");
    expect(resolveEffectiveFromEmail({ ...tenantMailSenderDefaults, mode: "smtp", fromEmail: "a@qq.com" }, configWithOfficial))
      .toBe("a@qq.com");
  });
});
