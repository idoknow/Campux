import { describe, expect, test } from "bun:test";
import { parseTelemetryReport, TELEMETRY_SCHEMA_VERSION } from "@campux/telemetry";
import { buildTelemetryReport, resolveTelemetryTarget, type TelemetrySnapshot } from "./telemetry";

const productionGate = {
  disabled: false,
  endpoint: "https://dash.campux.top",
  endpointExplicit: false,
  nodeEnv: "production" as const,
};

describe("resolveTelemetryTarget", () => {
  test("production instances report to the default collector", () => {
    expect(resolveTelemetryTarget(productionGate)).toBe("https://dash.campux.top/api/v1/report");
  });

  test("opt-out wins over everything", () => {
    expect(resolveTelemetryTarget({ ...productionGate, disabled: true })).toBeNull();
    expect(resolveTelemetryTarget({ ...productionGate, disabled: true, endpointExplicit: true })).toBeNull();
  });

  test("test env never reports", () => {
    expect(resolveTelemetryTarget({ ...productionGate, nodeEnv: "test", endpointExplicit: true })).toBeNull();
  });

  test("dev instances stay silent unless an endpoint is set explicitly", () => {
    expect(resolveTelemetryTarget({ ...productionGate, nodeEnv: "development" })).toBeNull();
    expect(
      resolveTelemetryTarget({
        disabled: false,
        endpoint: "http://localhost:8990",
        endpointExplicit: true,
        nodeEnv: "development",
      }),
    ).toBe("http://localhost:8990/api/v1/report");
  });

  test("normalizes trailing slashes and rejects non-http endpoints", () => {
    expect(resolveTelemetryTarget({ ...productionGate, endpoint: "https://dash.campux.top/" })).toBe(
      "https://dash.campux.top/api/v1/report",
    );
    expect(resolveTelemetryTarget({ ...productionGate, endpoint: "not a url" })).toBeNull();
    expect(resolveTelemetryTarget({ ...productionGate, endpoint: "ftp://dash.campux.top" })).toBeNull();
  });
});

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    instanceId: "0b8e9938-3c63-4c09-9a83-67c69e9c1638",
    instanceName: undefined,
    version: "main-ab12cd3",
    environment: "production",
    deployMode: "single",
    setupCompleted: true,
    uptimeSeconds: 123.9,
    emailConfigured: true,
    counts: { tenants: 1, users: 230, memberships: 231, postsTotal: 5400, postsLast24h: 12, botsEnabled: 1, publishTargets: 1 },
    aiTenants: 0,
    ...overrides,
  };
}

describe("buildTelemetryReport", () => {
  test("produces a payload that satisfies the shared wire schema", () => {
    const report = buildTelemetryReport(snapshot(), new Date("2026-06-10T12:00:00+08:00"));
    const parsed = parseTelemetryReport(report);
    expect(parsed.ok).toBe(true);
    expect(report.schemaVersion).toBe(TELEMETRY_SCHEMA_VERSION);
    expect(report.uptimeSeconds).toBe(123);
    expect(report.instanceName).toBeUndefined();
  });

  test("includes the opt-in instance name only when set and non-blank", () => {
    expect(buildTelemetryReport(snapshot({ instanceName: "  " }), new Date()).instanceName).toBeUndefined();
    expect(buildTelemetryReport(snapshot({ instanceName: " gz-wall " }), new Date()).instanceName).toBe("gz-wall");
  });

  test("never lets an empty build version through", () => {
    expect(buildTelemetryReport(snapshot({ version: "" }), new Date()).version).toBe("dev");
  });

  // Privacy contract: the report contains exactly these keys — aggregate
  // counters and coarse environment facts. If this test fails because a key
  // was added, make sure the new field is anonymous and update
  // docs/admin/telemetry.md before extending the list.
  test("the payload key set stays closed", () => {
    const report = buildTelemetryReport(snapshot(), new Date());
    expect(Object.keys(report).sort()).toEqual(
      [
        "counts",
        "deployMode",
        "environment",
        "features",
        "instanceId",
        "reportedAt",
        "runtime",
        "schemaVersion",
        "setupCompleted",
        "uptimeSeconds",
        "version",
      ].sort(),
    );
    expect(Object.keys(report.runtime).sort()).toEqual(["arch", "bunVersion", "inDocker", "platform"]);
    expect(Object.keys(report.features).sort()).toEqual(["aiTenants", "emailConfigured"]);
  });
});
