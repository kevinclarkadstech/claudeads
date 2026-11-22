import { AiReviewOutput, type AccountSummary, type AiAnalyst, type SummaryEntity } from "./types";

type Rec = AiReviewOutput["recommendations"][number];

/**
 * Stand-in for Claude while no API key is configured. It reads the same AccountSummary
 * the real model gets and combines rule findings into cross-entity advice (the kind of
 * judgment the AI layer is for), so the UI and data flow behave like the real thing.
 */
export function createMockAnalyst(opts: { latencyMs?: number } = {}): AiAnalyst {
  const latency = opts.latencyMs ?? 1500;
  return {
    provider: "mock",
    async analyze(summary) {
      if (latency > 0) await new Promise((r) => setTimeout(r, latency));
      const output = AiReviewOutput.parse(mockReview(summary)); // same contract as Claude's output
      const inputTokens = Math.round(JSON.stringify(summary).length / 4);
      return { output, model: "mock-analyst", inputTokens, outputTokens: Math.round(JSON.stringify(output).length / 4) };
    },
  };
}

export function mockReview(s: AccountSummary): AiReviewOutput {
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: s.account.currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
  const pct = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(Math.round(r * 100))}%`;
  const change = (r: number) => (Math.abs(r) < 0.01 ? "flat" : pct(r));
  const count = (n: number) => Math.round(n).toLocaleString("en-US");
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const groupWord = s.account.platform === "meta" ? "ad set" : "ad group";
  const all = [...s.campaigns, ...s.adGroups, ...s.ads];
  const byRef = new Map(all.map((e) => [e.ref, e]));
  const finding = (ruleId: string) => s.ruleFindings.find((f) => f.ruleId === ruleId);
  const entity = (ruleId: string): SummaryEntity | undefined => {
    const ref = finding(ruleId)?.entityRef;
    return ref ? byRef.get(ref) : undefined;
  };

  const recs: Rec[] = [];
  const tracking = finding("tracking_anomaly");
  const wasted = entity("wasted_spend");
  const winner = entity("budget_limited_winner");
  const spike = entity("cpa_spike");
  const fatigued = entity("creative_fatigue");
  const { recent: tr, baseline: tb } = s.totals;

  // 1. Broken tracking poisons every other metric: say so first.
  if (tracking) {
    const last = s.dailyTrend[s.dailyTrend.length - 1];
    const typicalConv = tb.conversions / 7;
    recs.push({
      title: "Fix conversion tracking before changing anything else",
      body:
        `Conversions fell to ${last?.conversions ?? 0} on ${last ? day(last.date) : "the last day"} against a typical ${count(typicalConv)}/day while clicks stayed normal. ` +
        `Until tracking is fixed, this week's cost per conversion and ROAS are understated, and automated bidding is learning from bad data. ` +
        `Hold budget and bid changes, and check your ${s.account.platform === "meta" ? "Pixel and Conversions API events" : "conversion actions and Google tag"} first.`,
      severity: "critical",
      category: "tracking",
      entityRef: null,
      expectedImpact: "Restores reliable data and bidding; prevents decisions based on missing conversions",
      confidence: "high",
      relatedRules: ["tracking_anomaly"],
    });
  }

  // 2. Wasted spend + a budget-capped winner → reallocate (the cross-entity call rules can't make).
  if (wasted && winner && winner.recent.roas) {
    const perDay = Math.round(wasted.recent.spend / 7 / 10) * 10 || Math.round(wasted.recent.spend / 7);
    const weeklyValue = perDay * 7 * winner.recent.roas * 0.8;
    recs.push({
      title: `Move ~${money(perDay)}/day from “${wasted.name}” to “${winner.name}”`,
      body:
        `${cap(groupWord)} “${wasted.name}” spent ${money(wasted.recent.spend)} last week with ${wasted.recent.conversions} conversions, ` +
        `while campaign “${winner.name}” returned ${winner.recent.roas.toFixed(2)}× and is capped by its ${money(winner.dailyBudget ?? 0)}/day budget. ` +
        `Pause the ${groupWord} and add the freed budget to the campaign in two steps a few days apart, so delivery can stabilize.`,
      severity: "warning",
      category: "budget",
      entityRef: wasted.ref,
      expectedImpact: `~${money(weeklyValue)}/week in conversion value, assuming 80% of current ROAS`,
      confidence: "medium",
      relatedRules: ["wasted_spend", "budget_limited_winner"],
    });
  } else if (wasted) {
    recs.push({
      title: `Pause “${wasted.name}”`,
      body: `It spent ${money(wasted.recent.spend)} last week with no conversions. Unless it is deliberately top-of-funnel, pause it and move the budget to your most efficient ${groupWord}.`,
      severity: "warning",
      category: "budget",
      entityRef: wasted.ref,
      expectedImpact: `~${money(wasted.recent.spend)}/week less wasted spend`,
      confidence: "high",
      relatedRules: ["wasted_spend"],
    });
  } else if (winner && winner.recent.roas) {
    recs.push({
      title: `Raise the budget on “${winner.name}” by 20%`,
      body: `It is spending its full ${money(winner.dailyBudget ?? 0)}/day budget at ${winner.recent.roas.toFixed(2)}× ROAS, above the account's ${tr.roas?.toFixed(2) ?? "average"}×. Increase gradually and check that ROAS holds.`,
      severity: "info",
      category: "budget",
      entityRef: winner.ref,
      expectedImpact: "More conversions at similar efficiency, if returns don't diminish quickly",
      confidence: "medium",
      relatedRules: ["budget_limited_winner"],
    });
  }

  // 3. CPA spike: is it isolated or account-wide? That decides where to act.
  if (spike && spike.recent.cpa && spike.baseline.cpa && tr.cpa && tb.cpa) {
    const entityChange = spike.recent.cpa / spike.baseline.cpa - 1;
    const accountChange = tr.cpa / tb.cpa - 1;
    const isolated = Math.abs(accountChange) < entityChange / 3;
    const parent = spike.parentRef ? byRef.get(spike.parentRef) : undefined;
    recs.push({
      title: isolated ? `Diagnose “${spike.name}” rather than changing account-wide bids` : "Cost per conversion is rising across the account",
      body: isolated
        ? `Its cost per conversion moved ${pct(entityChange)} (${money(spike.baseline.cpa)} → ${money(spike.recent.cpa)}) while the account overall moved only ${pct(accountChange)}, so the problem is local to this ${groupWord}${parent ? ` in “${parent.name}”` : ""}. ` +
          `Conversion rate went from ${fmtPct(spike.baseline.conversionRate)} to ${fmtPct(spike.recent.conversionRate)}: check its landing page, offer and audience before touching bids elsewhere.`
        : `Account cost per conversion moved ${pct(accountChange)} and “${spike.name}” ${pct(entityChange)}. Look for an account-wide cause such as site changes, seasonality or increased competition.`,
      severity: isolated ? "warning" : "critical",
      category: "targeting",
      entityRef: spike.ref,
      expectedImpact: isolated ? `Bring CPA back toward ${money(spike.baseline.cpa)} on ~${money(spike.recent.spend)}/week of spend` : "unclear",
      confidence: isolated ? "medium" : "low",
      relatedRules: ["cpa_spike"],
    });
  }

  // 4. Creative fatigue → a rotation plan, not just one swap.
  if (fatigued) {
    const siblings = s.ads.filter((a) => a.parentRef === fatigued.parentRef && a.ref !== fatigued.ref);
    const atRisk = siblings.filter((a) => (a.recent.frequency ?? 0) >= 3).length;
    recs.push({
      title: `Refresh creative in “${fatigued.parentRef ? byRef.get(fatigued.parentRef)?.name ?? "this ad set" : "this ad set"}”`,
      body:
        `“${fatigued.name}” is being shown ~${fatigued.recent.frequency?.toFixed(1)} times per person per day and its CTR fell from ${fmtPct(fatigued.baseline.ctr)} to ${fmtPct(fatigued.recent.ctr)}. ` +
        `Launch 2–3 new variations alongside it rather than replacing it outright${atRisk ? `; ${atRisk} other ad${atRisk > 1 ? "s" : ""} in the same ad set ${atRisk > 1 ? "are" : "is"} also above 3 frequency` : ""}.`,
      severity: "info",
      category: "creative",
      entityRef: fatigued.ref,
      expectedImpact: `Recover CTR toward ${fmtPct(fatigued.baseline.ctr)}`,
      confidence: "medium",
      relatedRules: ["creative_fatigue"],
    });
  }

  // 5. Concentration risk (pattern no rule covers).
  const top = s.campaigns[0];
  if (recs.length < 5 && top && tr.spend > 0 && top.recent.spend / tr.spend > 0.4) {
    recs.push({
      title: `${Math.round((top.recent.spend / tr.spend) * 100)}% of spend is in one campaign`,
      body: `“${top.name}” took ${money(top.recent.spend)} of ${money(tr.spend)} last week. If its performance slips, the whole account follows; consider building a second campaign that can absorb budget.`,
      severity: "info",
      category: "structure",
      entityRef: top.ref,
      expectedImpact: "Lower risk; no direct short-term gain",
      confidence: "low",
      relatedRules: [],
    });
  }

  // Overall assessment.
  const spendChange = tb.spend ? tr.spend / tb.spend - 1 : null;
  const cpaChange = tr.cpa && tb.cpa ? tr.cpa / tb.cpa - 1 : null;
  const headline =
    `Last week ${s.account.name} spent ${money(tr.spend)}${spendChange !== null ? ` (${change(spendChange)} vs. your weekly average)` : ""} ` +
    `for ${count(tr.conversions)} conversions${tr.cpa ? ` at ${money(tr.cpa)} each${cpaChange !== null ? ` (${change(cpaChange)})` : ""}` : ""}.`;
  const focus = tracking
    ? " Conversion tracking appears broken, so treat this week's efficiency numbers with caution and fix that first."
    : recs.length
      ? ` The biggest lever this week: ${lowerFirst(recs[0]!.title)}.`
      : " Nothing needs urgent attention; keep an eye on frequency and cost per conversion as spend grows.";

  return { summary: headline + focus, recommendations: recs.slice(0, 5) };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const fmtPct = (r: number | null) => (r == null ? "n/a" : `${(r * 100).toFixed(2)}%`);
