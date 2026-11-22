import { describe, expect, it } from "vitest";
import { buildTree, createMockProvider, generateMetrics } from "../src/worker/providers/mock";

const TODAY = new Date("2026-11-22T12:00:00Z");
const range = { start: "2026-10-24", end: "2026-11-22" }; // 30 days

const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

describe("mock provider", () => {
  it("is deterministic", () => {
    const a = generateMetrics("meta", "act_1000000001", range, TODAY);
    const b = generateMetrics("meta", "act_1000000001", range, TODAY);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
  });

  it("returns parents before children with valid parent refs", () => {
    for (const platform of ["meta", "google"] as const) {
      const { entities } = buildTree(platform, platform === "meta" ? "act_1000000001" : "1234567890");
      const seen = new Set<string>();
      for (const e of entities) {
        if (e.parentExternalId) expect(seen.has(e.parentExternalId)).toBe(true);
        seen.add(e.externalId);
      }
      expect(entities.filter((e) => e.level === "campaign")).toHaveLength(4);
    }
  });

  it("campaign rows equal the sum of their ads", () => {
    const rows = generateMetrics("google", "1234567890", { start: "2026-11-20", end: "2026-11-20" }, TODAY);
    const { ads } = buildTree("google", "1234567890");
    const campaign = rows.find((r) => r.level === "campaign")!;
    const childIds = new Set(ads.filter((a) => a.campaignExternalId === campaign.externalId).map((a) => a.externalId));
    const adRows = rows.filter((r) => r.level === "ad" && childIds.has(r.externalId));
    expect(campaign.spendMicros).toBe(sum(adRows, (r) => r.spendMicros));
    expect(campaign.clicks).toBe(sum(adRows, (r) => r.clicks));
  });

  it("plants a CPA spike in the last 7 days", () => {
    const { ads } = buildTree("meta", "act_1000000001");
    const groupId = ads.find((a) => a.anomaly === "cpa_spike")!.adGroupExternalId;
    const rows = generateMetrics("meta", "act_1000000001", range, TODAY).filter(
      (r) => r.level === "ad_group" && r.externalId === groupId,
    );
    const recent = rows.filter((r) => r.date >= "2026-11-16");
    const prior = rows.filter((r) => r.date < "2026-11-16");
    const cpa = (rs: typeof rows) => sum(rs, (r) => r.spendMicros) / sum(rs, (r) => r.conversions);
    expect(cpa(recent) / cpa(prior)).toBeGreaterThan(1.5);
  });

  it("plants creative fatigue: rising frequency, falling CTR", () => {
    const { ads } = buildTree("meta", "act_1000000001");
    const id = ads.find((a) => a.anomaly === "fatigue")!.externalId;
    const rows = generateMetrics("meta", "act_1000000001", range, TODAY).filter((r) => r.externalId === id);
    const first = rows.slice(0, 7);
    const last = rows.slice(-7);
    const freq = (rs: typeof rows) => sum(rs, (r) => r.impressions) / sum(rs, (r) => r.reach!);
    const ctr = (rs: typeof rows) => sum(rs, (r) => r.clicks) / sum(rs, (r) => r.impressions);
    expect(freq(last)).toBeGreaterThan(4);
    expect(freq(last)).toBeGreaterThan(freq(first));
    expect(ctr(last)).toBeLessThan(ctr(first) * 0.8);
  });

  it("plants an ad group with spend and zero conversions", () => {
    const { ads } = buildTree("meta", "act_1000000001");
    const groupId = ads.find((a) => a.anomaly === "no_conversions")!.adGroupExternalId;
    const rows = generateMetrics("meta", "act_1000000001", range, TODAY).filter((r) => r.externalId === groupId);
    expect(sum(rows, (r) => r.spendMicros)).toBeGreaterThan(0);
    expect(sum(rows, (r) => r.conversions)).toBe(0);
  });

  it("plants a tracking break in the secondary account", () => {
    const rows = generateMetrics("meta", "act_1000000002", range, TODAY).filter((r) => r.level === "campaign");
    const lastTwo = rows.filter((r) => r.date >= "2026-11-21");
    const before = rows.filter((r) => r.date === "2026-11-19");
    expect(sum(lastTwo, (r) => r.conversions)).toBe(0);
    expect(sum(lastTwo, (r) => r.clicks)).toBeGreaterThan(0);
    expect(sum(before, (r) => r.conversions)).toBeGreaterThan(0);
  });

  it("only reports reach for Meta", () => {
    const g = generateMetrics("google", "1234567890", { start: "2026-11-20", end: "2026-11-20" }, TODAY);
    expect(g.every((r) => r.reach === undefined)).toBe(true);
  });

  it("round-trips the mock OAuth flow", async () => {
    const p = createMockProvider("meta");
    const url = new URL(p.getAuthorizationUrl({ state: "s1", redirectUri: "http://x/cb" }));
    expect(url.searchParams.get("state")).toBe("s1");
    const tokens = await p.exchangeCode({ code: url.searchParams.get("code")!, redirectUri: "http://x/cb" });
    expect(tokens.scopes).toEqual(["ads_read"]);
    await expect(p.exchangeCode({ code: "bogus", redirectUri: "" })).rejects.toThrow();
    expect(await p.listAdAccounts(tokens.accessToken)).toHaveLength(2);
  });
});
