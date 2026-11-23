import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoApi } from "../src/client/demo/demo-api";
import { ApiError } from "../src/client/lib/api";

// Only fake Date: the demo's simulated sync/AI durations are time-based, its network delays use setTimeout.
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-22T15:00:00Z") }));
afterEach(() => vi.useRealTimers());
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("in-browser demo API", () => {
  it("starts with both platforms connected and three accounts selected", async () => {
    const api = createDemoApi();
    expect(api.isDemo).toBe(true);
    const { connections, mockMode } = await api.connections();
    expect(mockMode).toBe(true);
    const accounts = connections.flatMap((c) => c.adAccounts);
    expect(accounts).toHaveLength(4);
    expect(accounts.filter((a) => a.isSelected)).toHaveLength(3);
    expect(accounts.filter((a) => a.lastSyncedAt)).toHaveLength(3);
  });

  it("serves metrics in the server's shape", async () => {
    const m = await createDemoApi().metrics("meta-us", 30, "campaign");
    expect(m.daily).toHaveLength(30);
    expect(m.entities).toHaveLength(4);
    expect(m.totals.current.spendMicros).toBeGreaterThan(0);
    expect(m.totals.previous.spendMicros).toBeGreaterThan(0);
    // Daily totals sum to the period total.
    expect(m.daily.reduce((s, d) => s + d.spendMicros, 0)).toBe(m.totals.current.spendMicros);
    expect((await createDemoApi().metrics("meta-us", 7, "ad_group")).entities[0]!.parentName).toBeTruthy();
  });

  it("produces the rule recommendations, with working status changes", async () => {
    const api = createDemoApi();
    const { recommendations, counts } = await api.recommendations("open");
    const rules = new Set(recommendations.map((r) => r.ruleId));
    for (const r of ["tracking_anomaly", "cpa_spike", "wasted_spend", "creative_fatigue", "budget_limited_winner"]) expect(rules).toContain(r);
    expect(counts.open).toBe(recommendations.length);
    // Severity order.
    const rank = { critical: 0, warning: 1, info: 2 };
    const ranks = recommendations.map((r) => rank[r.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    await api.setRecommendationStatus(recommendations[0]!.id, "dismissed");
    const after = await api.recommendations("open");
    expect(after.counts.dismissed).toBe(1);
    expect(after.recommendations.find((r) => r.id === recommendations[0]!.id)).toBeUndefined();
  });

  it("runs an AI review asynchronously and adds AI recommendations", async () => {
    const api = createDemoApi();
    expect((await api.aiReview("meta-us")).review).toBeNull();
    await api.runAiReview("meta-us");
    expect((await api.aiReview("meta-us")).review!.status).toBe("running");
    await expect(api.runAiReview("meta-us")).rejects.toBeInstanceOf(ApiError);
    advance(3000);
    const { review } = await api.aiReview("meta-us");
    expect(review!.status).toBe("succeeded");
    expect(review!.summary).toMatch(/spent/);
    const ai = (await api.recommendations("open", "meta-us")).recommendations.filter((r) => r.source === "ai");
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.some((r) => r.title.startsWith("Move ~"))).toBe(true);
  });

  it("selecting an unsynced account simulates an import", async () => {
    const api = createDemoApi();
    expect((await api.recommendations("open", "google-shopping")).recommendations).toHaveLength(0);
    const { syncStarted } = await api.setAccountSelected("google-shopping", true);
    expect(syncStarted).toBe(true);
    expect((await api.adAccount("google-shopping")).adAccount.latestSync!.status).toBe("running");
    advance(3000);
    expect((await api.adAccount("google-shopping")).adAccount.lastSyncedAt).not.toBeNull();
    const recs = (await api.recommendations("open", "google-shopping")).recommendations;
    expect(recs.some((r) => r.ruleId === "tracking_anomaly")).toBe(true);
  });

  it("rejects disconnects and unknown accounts", async () => {
    const api = createDemoApi();
    await expect(api.disconnect("conn-meta")).rejects.toBeInstanceOf(ApiError);
    await expect(api.adAccount("nope")).rejects.toMatchObject({ status: 404 });
  });
});
