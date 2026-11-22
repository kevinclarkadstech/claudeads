import type { EntityStats, Finding, Level, Rule, RuleContext, Totals } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cpa = (t: Totals) => (t.conversions > 0 ? t.spendMicros / t.conversions : null);
const ctr = (t: Totals) => (t.impressions > 0 ? t.clicks / t.impressions : null);
const cvr = (t: Totals) => (t.clicks > 0 ? t.conversions / t.clicks : null);
const cpc = (t: Totals) => (t.clicks > 0 ? t.spendMicros / t.clicks : null);
const roas = (t: Totals) => (t.spendMicros > 0 ? t.conversionValueMicros / t.spendMicros : null);
const frequency = (t: Totals) => (t.reach ? t.impressions / t.reach : null);

export function sumTotals(rows: Totals[]): Totals {
  const out: Totals = { impressions: 0, clicks: 0, spendMicros: 0, conversions: 0, conversionValueMicros: 0, reach: null };
  for (const r of rows) {
    out.impressions += r.impressions;
    out.clicks += r.clicks;
    out.spendMicros += r.spendMicros;
    out.conversions += r.conversions;
    out.conversionValueMicros += r.conversionValueMicros;
    if (r.reach != null) out.reach = (out.reach ?? 0) + r.reach;
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const active = (e: EntityStats) => e.status === "active";

function money(micros: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: micros >= 1000e6 ? 0 : 2,
  }).format(micros / 1e6);
}
const pct = (r: number, d = 1) => `${(r * 100).toFixed(d)}%`;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function levelName(platform: "meta" | "google", level: Level): string {
  if (level === "ad_group") return platform === "meta" ? "ad set" : "ad group";
  return level;
}

/** `“Name”` plus its parent for context, e.g. `ad set “Hiking” (in “Prospecting”)`. */
function label(ctx: RuleContext, e: EntityStats): string {
  const parent = e.parentName ? ` (in “${e.parentName}”)` : "";
  return `${levelName(ctx.account.platform, e.level)} “${e.name}”${parent}`;
}

function accountTotals(ctx: RuleContext, window: "recent" | "baseline"): Totals {
  return sumTotals(ctx.entities.filter((e) => e.level === "campaign").map((e) => e[window]));
}

// ---------------------------------------------------------------------------
// 1. CPA spike
// ---------------------------------------------------------------------------

export const cpaSpike: Rule = (ctx) => {
  const c = ctx.config.cpaSpike;
  const out: Finding[] = [];
  for (const e of ctx.entities) {
    if (e.level !== "ad_group" || !active(e)) continue;
    const base = cpa(e.baseline);
    if (base === null || e.baseline.conversions < c.minBaselineConversions) continue;
    if (e.recent.spendMicros < c.minRecentSpendMicros) continue;
    // Zero recent conversions is the wasted-spend rule's job.
    const now = cpa(e.recent);
    if (now === null) continue;
    const increase = now / base - 1;
    if (increase < c.minIncrease) continue;

    // Attribute the change: pricier clicks (auction) or fewer conversions per click (post-click).
    const cpcChange = (cpc(e.recent) ?? 0) / (cpc(e.baseline) || 1) - 1;
    const cvrChange = (cvr(e.recent) ?? 0) / (cvr(e.baseline) || 1) - 1;
    const driver = Math.abs(cvrChange) >= Math.abs(cpcChange) ? "conversion_rate" : "cpc";
    const advice =
      driver === "conversion_rate"
        ? `Conversion rate fell from ${pct(cvr(e.baseline)!)} to ${pct(cvr(e.recent) ?? 0)} while cost per click ${Math.abs(cpcChange) < 0.1 ? "stayed roughly flat" : `changed ${signed(cpcChange)}`}, so the problem is after the click: check the landing page, offer, stock levels and audience quality.`
        : `Cost per click rose ${pct(cpcChange, 0)} while conversion rate held near ${pct(cvr(e.recent) ?? 0)}, so you're paying more for the same traffic: check auction competition, bid strategy and audience overlap.`;
    const excessMicros = e.recent.spendMicros - e.recent.conversions * base;

    out.push({
      ruleId: "cpa_spike",
      entityId: e.id,
      severity: increase >= c.criticalIncrease ? "critical" : "warning",
      title: `Cost per conversion up ${pct(increase, 0)} in “${e.name}”`,
      body: `Cost per conversion for ${label(ctx, e)} was ${money(now, ctx.account.currency)} over the last 7 days, up from ${money(base, ctx.account.currency)} over the previous 28 days. ${advice}`,
      evidence: {
        recentCpaMicros: Math.round(now),
        baselineCpaMicros: Math.round(base),
        increase: round(increase, 3),
        recentConversionRate: round(cvr(e.recent) ?? 0, 4),
        baselineConversionRate: round(cvr(e.baseline) ?? 0, 4),
        cpcChange: round(cpcChange, 3),
        driver,
      },
      estimatedImpact: { metric: "spend", direction: "save", amountMicros: Math.round(excessMicros), period: "7d" },
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// 2. Creative fatigue (needs reach → Meta)
// ---------------------------------------------------------------------------

export const creativeFatigue: Rule = (ctx) => {
  const c = ctx.config.fatigue;
  const out: Finding[] = [];
  for (const e of ctx.entities) {
    if (e.level !== "ad" || !active(e) || e.recent.impressions < c.minImpressions) continue;
    const freq = frequency(e.recent);
    const nowCtr = ctr(e.recent);
    const baseCtr = ctr(e.baseline);
    if (freq === null || nowCtr === null || !baseCtr || freq < c.minFrequency) continue;
    const drop = 1 - nowCtr / baseCtr;
    if (drop < c.minCtrDrop) continue;

    out.push({
      ruleId: "creative_fatigue",
      entityId: e.id,
      severity: "warning",
      title: `Creative fatigue on “${e.name}”`,
      body: `People are seeing ${label(ctx, e)} about ${freq.toFixed(1)} times each per day, and its CTR has fallen ${pct(drop, 0)} (${pct(baseCtr, 2)} → ${pct(nowCtr, 2)}). The audience is tiring of it: launch fresh creative or variations, or widen the audience so it reaches new people.`,
      evidence: { frequency: round(freq, 2), recentCtr: round(nowCtr, 5), baselineCtr: round(baseCtr, 5), ctrDrop: round(drop, 3) },
      estimatedImpact: { metric: "ctr", direction: "increase", note: "Restore CTR toward its earlier level" },
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// 3. Wasted spend: meaningful spend, zero conversions
// ---------------------------------------------------------------------------

export const wastedSpend: Rule = (ctx) => {
  const c = ctx.config.wastedSpend;
  const accountCpa = cpa(accountTotals(ctx, "baseline")) ?? cpa(accountTotals(ctx, "recent"));
  if (accountCpa === null) return [];
  const threshold = Math.max(c.minSpendMicros, accountCpa * c.cpaMultiple);
  const out: Finding[] = [];
  const flaggedGroups = new Set<string>();

  // Ad groups first so ads inside a flagged group are not reported twice.
  for (const level of ["ad_group", "ad"] as const) {
    for (const e of ctx.entities) {
      if (e.level !== level || !active(e)) continue;
      if (level === "ad" && e.parentId && flaggedGroups.has(e.parentId)) continue;
      if (e.recent.conversions > 0 || e.recent.spendMicros < threshold) continue;
      if (level === "ad_group") flaggedGroups.add(e.id);
      const multiple = e.recent.spendMicros / accountCpa;
      out.push({
        ruleId: "wasted_spend",
        entityId: e.id,
        severity: multiple >= c.cpaMultiple * 2 ? "critical" : "warning",
        title: `“${e.name}” spent ${money(e.recent.spendMicros, ctx.account.currency)} with no conversions`,
        body: `${capitalize(label(ctx, e))} spent ${money(e.recent.spendMicros, ctx.account.currency)} in the last 7 days without a single conversion. That's ${multiple.toFixed(1)}× your account's typical cost per conversion (${money(accountCpa, ctx.account.currency)}). Pause it or move its budget to better performers, unless it's intentionally upper-funnel.`,
        evidence: { spendMicros: e.recent.spendMicros, clicks: e.recent.clicks, accountCpaMicros: Math.round(accountCpa), spendToCpa: round(multiple, 2) },
        estimatedImpact: { metric: "spend", direction: "save", amountMicros: e.recent.spendMicros, period: "7d" },
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// 4. Budget-limited winner
// ---------------------------------------------------------------------------

export const budgetLimitedWinner: Rule = (ctx) => {
  const c = ctx.config.budgetLimited;
  const accountRoas = roas(accountTotals(ctx, "recent"));
  if (!accountRoas) return [];
  const days = 7;
  const out: Finding[] = [];
  for (const e of ctx.entities) {
    if (e.level !== "campaign" || !active(e) || !e.dailyBudgetMicros) continue;
    const r = roas(e.recent);
    if (r === null || e.recent.conversions < c.minConversions) continue;
    const utilization = e.recent.spendMicros / days / e.dailyBudgetMicros;
    if (utilization < c.minUtilization || r < accountRoas * c.minRoasMultiple) continue;

    // Assume +20% budget at 80% of current efficiency (returns diminish as spend scales).
    const extraSpendWeek = e.dailyBudgetMicros * 0.2 * days;
    const extraValueWeek = extraSpendWeek * r * 0.8;
    const extraConvWeek = (extraSpendWeek / (cpa(e.recent) ?? Infinity)) * 0.8;

    out.push({
      ruleId: "budget_limited_winner",
      entityId: e.id,
      severity: "info",
      title: `“${e.name}” is limited by budget`,
      body: `Campaign “${e.name}” is spending ${pct(utilization, 0)} of its ${money(e.dailyBudgetMicros, ctx.account.currency)}/day budget, with ROAS of ${r.toFixed(2)}× against ${accountRoas.toFixed(2)}× for the account. Raising its budget 20% could add about ${Math.round(extraConvWeek)} conversions (≈${money(extraValueWeek, ctx.account.currency)} in value) per week. Increase gradually and watch whether efficiency holds.`,
      evidence: { utilization: round(utilization, 3), roas: round(r, 2), accountRoas: round(accountRoas, 2), dailyBudgetMicros: e.dailyBudgetMicros },
      estimatedImpact: {
        metric: "conversion_value",
        direction: "increase",
        amountMicros: Math.round(extraValueWeek),
        conversions: Math.round(extraConvWeek),
        period: "7d",
        assumption: "+20% budget at 80% of current ROAS",
      },
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// 5. Low CTR outlier (vs. other ads in the account)
// ---------------------------------------------------------------------------

export const lowCtr: Rule = (ctx) => {
  const c = ctx.config.lowCtr;
  const ads = ctx.entities.filter((e) => e.level === "ad" && active(e) && e.recent.impressions >= c.minImpressions);
  if (ads.length < c.minPeers) return [];
  const med = median(ads.map((e) => ctr(e.recent)!));
  if (!med) return [];
  const out: Finding[] = [];
  for (const e of ads) {
    const v = ctr(e.recent)!;
    if (v >= med * c.maxRatioToMedian) continue;
    out.push({
      ruleId: "low_ctr",
      entityId: e.id,
      severity: "info",
      title: `Low click-through rate on “${e.name}”`,
      body: `${capitalize(label(ctx, e))} has a CTR of ${pct(v, 2)}, less than half the ${pct(med, 2)} median across your other ads. Low CTR usually means the ${ctx.account.platform === "meta" ? "creative or hook" : "ad copy or keyword match"} isn't resonating with this audience; test a new variant against it or pause it.`,
      evidence: { ctr: round(v, 5), medianCtr: round(med, 5), impressions: e.recent.impressions },
      estimatedImpact: { metric: "ctr", direction: "increase" },
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// 6. Tracking anomaly: clicks continue but conversions vanish
// ---------------------------------------------------------------------------

export const trackingAnomaly: Rule = (ctx) => {
  const c = ctx.config.tracking;
  const base = ctx.accountDaily.filter((d) => d.date >= ctx.windows.baselineStart && d.date <= ctx.windows.baselineEnd);
  if (base.length < 14) return [];
  const baseDaily = sumTotals(base);
  const avgConv = baseDaily.conversions / base.length;
  const avgClicks = baseDaily.clicks / base.length;
  if (avgConv < c.minBaselineDailyConversions) return [];

  const last = ctx.accountDaily.find((d) => d.date === ctx.windows.recentEnd);
  if (!last) return [];
  if (last.clicks < avgClicks * c.minClickRatio || last.conversions > avgConv * c.maxConversionRatio) return [];

  // How many consecutive days (ending at the last complete day) look broken.
  let brokenDays = 0;
  for (let i = ctx.accountDaily.length - 1; i >= 0; i--) {
    const d = ctx.accountDaily[i]!;
    if (d.date > ctx.windows.recentEnd) continue;
    if (d.clicks >= avgClicks * c.minClickRatio && d.conversions <= avgConv * c.maxConversionRatio) brokenDays++;
    else break;
  }
  const tool = ctx.account.platform === "meta" ? "Meta Events Manager (Pixel / Conversions API)" : "Google Ads conversion actions and your Google tag";

  return [{
    ruleId: "tracking_anomaly",
    entityId: null,
    severity: "critical",
    title: brokenDays > 1 ? `Conversions stopped recording ${brokenDays} days ago` : "Conversions dropped to near zero yesterday",
    body: `Your ads got ${Math.round(last.clicks).toLocaleString("en-US")} clicks on ${dayLabel(last.date)} (typical: ${Math.round(avgClicks).toLocaleString("en-US")}/day) but recorded ${last.conversions === 0 ? "no conversions" : `only ${last.conversions} conversions`}, against a typical ${avgConv.toFixed(0)}/day. Traffic is normal, so this is most likely broken conversion tracking rather than performance. Check ${tool}, and recent website or checkout changes. Automated bidding optimizes on this data, so fix it quickly.`,
    evidence: { date: last.date, clicks: last.clicks, conversions: last.conversions, avgDailyClicks: round(avgClicks, 1), avgDailyConversions: round(avgConv, 1), brokenDays },
    estimatedImpact: null,
  }];
};

const signed = (r: number) => `${r > 0 ? "+" : "−"}${pct(Math.abs(r), 0)}`;

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const RULES: Record<string, Rule> = {
  tracking_anomaly: trackingAnomaly,
  cpa_spike: cpaSpike,
  wasted_spend: wastedSpend,
  creative_fatigue: creativeFatigue,
  budget_limited_winner: budgetLimitedWinner,
  low_ctr: lowCtr,
};

/** Run every rule and drop overlaps. */
export function evaluate(ctx: RuleContext): Finding[] {
  const findings = Object.values(RULES).flatMap((rule) => rule(ctx));
  // A fatigued ad's low CTR is the same story told twice; keep the more specific fatigue finding.
  const fatigued = new Set(findings.filter((f) => f.ruleId === "creative_fatigue").map((f) => f.entityId));
  return findings.filter((f) => !(f.ruleId === "low_ctr" && fatigued.has(f.entityId)));
}
