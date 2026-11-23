import { describe, expect, it } from "vitest";
import { buildTree, generateMetrics } from "../src/worker/providers/mock";
import type { Platform } from "../src/worker/providers/types";
import { contextFromProviderData, windowsFor } from "../src/worker/rules/context";
import { evaluate, sumTotals, cpaSpike, wastedSpend, trackingAnomaly, lowCtr } from "../src/worker/rules/rules";
import { DEFAULT_CONFIG, type RuleContext } from "../src/worker/rules/types";

const TODAY = "2026-11-22";

/** Mock-provider data → RuleContext via the same pure builder the demo uses. */
function mockContext(platform: Platform, accountExternalId: string): RuleContext {
  const today = new Date(`${TODAY}T12:00:00Z`);
  const w = windowsFor(TODAY);
  return contextFromProviderData({
    account: { id: accountExternalId, platform, currency: "USD" },
    today: TODAY,
    entities: buildTree(platform, accountExternalId).entities,
    rows: generateMetrics(platform, accountExternalId, { start: w.baselineStart, end: w.recentEnd }, today),
  });
}

const anomalyAds = (platform: Platform, account: string) => buildTree(platform, account).ads;

describe("rules on mock accounts", () => {
  it("windows end yesterday and don't overlap", () => {
    expect(windowsFor(TODAY)).toEqual({
      recentStart: "2026-11-15",
      recentEnd: "2026-11-21",
      baselineStart: "2026-10-18",
      baselineEnd: "2026-11-14",
    });
  });

  it("Meta primary account: flags each planted problem on the right entity", () => {
    const ctx = mockContext("meta", "act_1000000001");
    const findings = evaluate(ctx);
    const ads = anomalyAds("meta", "act_1000000001");
    const by = (rule: string) => findings.filter((f) => f.ruleId === rule).map((f) => f.entityId);

    expect(by("cpa_spike")).toEqual([ads.find((a) => a.anomaly === "cpa_spike")!.adGroupExternalId]);
    expect(by("creative_fatigue")).toEqual([ads.find((a) => a.anomaly === "fatigue")!.externalId]);
    expect(by("wasted_spend")).toEqual([ads.find((a) => a.anomaly === "no_conversions")!.adGroupExternalId]);
    expect(by("budget_limited_winner")).toEqual([ads.find((a) => a.anomaly === "winner")!.campaignExternalId]);
    expect(by("tracking_anomaly")).toEqual([]);
    // The fatigued ad must not also be reported as low-CTR.
    expect(by("low_ctr")).not.toContain(ads.find((a) => a.anomaly === "fatigue")!.externalId);
  });

  it("Meta secondary account: detects the tracking break and nothing spurious from it", () => {
    const findings = evaluate(mockContext("meta", "act_1000000002"));
    const tracking = findings.filter((f) => f.ruleId === "tracking_anomaly");
    expect(tracking).toHaveLength(1);
    expect(tracking[0]!.severity).toBe("critical");
    expect(tracking[0]!.evidence.conversions).toBe(0);
    expect(tracking[0]!.body).toContain("recorded no conversions");
    expect(tracking[0]!.body).toMatch(/clicks on [A-Z][a-z]{2} \d+/);
    expect(findings.filter((f) => f.ruleId === "wasted_spend")).toHaveLength(0);
  });

  it("Google: no fatigue findings (no reach data) but other rules still work", () => {
    const findings = evaluate(mockContext("google", "1234567890"));
    expect(findings.some((f) => f.ruleId === "creative_fatigue")).toBe(false);
    expect(findings.some((f) => f.ruleId === "wasted_spend")).toBe(true);
    expect(findings.some((f) => f.ruleId === "cpa_spike")).toBe(true);
    // Google wording.
    expect(findings.find((f) => f.ruleId === "cpa_spike")!.body).toContain("ad group");
  });

  it("findings have readable text and stable shape", () => {
    for (const f of evaluate(mockContext("meta", "act_1000000001"))) {
      expect(f.title.length).toBeGreaterThan(10);
      expect(f.body).not.toMatch(/NaN|undefined|Infinity|null/);
      expect(["info", "warning", "critical"]).toContain(f.severity);
    }
  });
});

describe("rule guards", () => {
  const base = mockContext("meta", "act_1000000001");

  it("cpa_spike ignores ad groups below the minimum baseline conversions", () => {
    const ctx = { ...base, config: { ...DEFAULT_CONFIG, cpaSpike: { ...DEFAULT_CONFIG.cpaSpike, minBaselineConversions: 1e9 } } };
    expect(cpaSpike(ctx)).toHaveLength(0);
  });

  it("wasted_spend ignores paused entities", () => {
    const ctx = { ...base, entities: base.entities.map((e) => ({ ...e, status: "paused" })) };
    expect(wastedSpend(ctx)).toHaveLength(0);
  });

  it("tracking_anomaly needs a baseline", () => {
    expect(trackingAnomaly({ ...base, accountDaily: base.accountDaily.slice(-7) })).toHaveLength(0);
  });

  it("low_ctr flags an ad far below the median CTR", () => {
    const target = base.entities.find((e) => e.level === "ad" && e.recent.impressions > 5000)!;
    const ctx = {
      ...base,
      entities: base.entities.map((e) => (e.id === target.id ? { ...e, recent: { ...e.recent, clicks: Math.round(e.recent.clicks * 0.2) } } : e)),
    };
    const fatiguedAd = buildTree("meta", "act_1000000001").ads.find((a) => a.anomaly === "fatigue")!.externalId;
    // lowCtr alone also catches the fatigued ad; evaluate() removes that overlap.
    expect(lowCtr(ctx).map((f) => f.entityId).sort()).toEqual([target.id, fatiguedAd].sort());
    const combined = evaluate(ctx).filter((f) => f.ruleId === "low_ctr");
    expect(combined.map((f) => f.entityId)).toEqual([target.id]);
    expect(combined[0]!.body).toContain("median");
  });

  it("no data → no findings", () => {
    const empty = sumTotals([]);
    const ctx: RuleContext = {
      ...base,
      entities: base.entities.map((e) => ({ ...e, recent: empty, baseline: empty })),
      accountDaily: base.accountDaily.map((d) => ({ ...d, ...empty })),
    };
    expect(evaluate(ctx)).toEqual([]);
  });
});
