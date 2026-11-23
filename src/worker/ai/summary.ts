import type { EntityStats, Finding, RuleContext, Totals } from "../rules/types";
import type { AccountSummary, SummaryEntity, WindowStats } from "./types";

/** Size caps keep the prompt small and cost predictable for large accounts. */
const CAPS = { campaign: 15, ad_group: 25, ad: 30 } as const;
const PREFIX = { campaign: "C", ad_group: "G", ad: "A" } as const;
const TREND_DAYS = 14;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

function stats(t: Totals): WindowStats {
  const spend = t.spendMicros / 1e6;
  const value = t.conversionValueMicros / 1e6;
  return {
    spend: r2(spend),
    impressions: t.impressions,
    clicks: t.clicks,
    conversions: r2(t.conversions),
    conversionValue: r2(value),
    ctr: t.impressions ? r4(t.clicks / t.impressions) : null,
    cpc: t.clicks ? r2(spend / t.clicks) : null,
    conversionRate: t.clicks ? r4(t.conversions / t.clicks) : null,
    cpa: t.conversions ? r2(spend / t.conversions) : null,
    roas: spend ? r2(value / spend) : null,
    frequency: t.reach ? r2(t.impressions / t.reach) : null,
  };
}

/** Baseline covers 28 days; scale counts to a 7-day equivalent so recent vs. baseline compare directly. */
function weekly(t: Totals): Totals {
  const k = 7 / 28;
  return {
    impressions: Math.round(t.impressions * k),
    clicks: Math.round(t.clicks * k),
    spendMicros: t.spendMicros * k,
    conversions: t.conversions * k,
    conversionValueMicros: t.conversionValueMicros * k,
    reach: t.reach == null ? null : t.reach * k,
  };
}

function sum(rows: Totals[]): Totals {
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

/**
 * Build the AI's input from the rules' context. Entities get short refs (C1, G4, A12) so
 * internal ids never reach the model and its answers are easy to map back.
 */
export function buildAccountSummary(
  ctx: RuleContext,
  findings: Finding[],
  account: { name: string; timezone: string },
): { summary: AccountSummary; refs: Map<string, string> } {
  const refs = new Map<string, string>(); // ref -> entity id
  const refOf = new Map<string, string>(); // entity id -> ref
  const omitted = { campaigns: 0, adGroups: 0, ads: 0 };
  const lists: Record<keyof typeof CAPS, SummaryEntity[]> = { campaign: [], ad_group: [], ad: [] };

  for (const level of ["campaign", "ad_group", "ad"] as const) {
    const all = ctx.entities
      .filter((e) => e.level === level && (e.recent.spendMicros > 0 || e.baseline.spendMicros > 0))
      .sort((a, b) => b.recent.spendMicros - a.recent.spendMicros);
    const kept = all.slice(0, CAPS[level]);
    const key = level === "campaign" ? "campaigns" : level === "ad_group" ? "adGroups" : "ads";
    omitted[key] = all.length - kept.length;
    kept.forEach((e: EntityStats, i) => {
      const ref = `${PREFIX[level]}${i + 1}`;
      refs.set(ref, e.id);
      refOf.set(e.id, ref);
      lists[level].push({
        ref,
        name: e.name,
        parentRef: e.parentId ? refOf.get(e.parentId) ?? null : null,
        status: e.status,
        ...(level === "campaign" ? { dailyBudget: e.dailyBudgetMicros != null ? r2(e.dailyBudgetMicros / 1e6) : null } : {}),
        recent: stats(e.recent),
        baseline: stats(weekly(e.baseline)),
      });
    });
  }

  const campaigns = ctx.entities.filter((e) => e.level === "campaign");
  const trend = ctx.accountDaily.slice(-TREND_DAYS).map((d) => ({
    date: d.date,
    spend: r2(d.spendMicros / 1e6),
    conversions: r2(d.conversions),
    clicks: d.clicks,
  }));

  return {
    refs,
    summary: {
      account: { name: account.name, platform: ctx.account.platform, currency: ctx.account.currency, timezone: account.timezone },
      windows: {
        recent: `${ctx.windows.recentStart}..${ctx.windows.recentEnd} (last 7 complete days)`,
        baseline: `${ctx.windows.baselineStart}..${ctx.windows.baselineEnd} (28 days before, shown as a weekly average so it compares directly with recent)`,
      },
      totals: {
        recent: stats(sum(campaigns.map((c) => c.recent))),
        baseline: stats(weekly(sum(campaigns.map((c) => c.baseline)))),
      },
      campaigns: lists.campaign,
      adGroups: lists.ad_group,
      ads: lists.ad,
      omitted,
      dailyTrend: trend,
      ruleFindings: findings.map((f) => ({
        ruleId: f.ruleId,
        severity: f.severity,
        entityRef: f.entityId ? refOf.get(f.entityId) ?? null : null,
        title: f.title,
      })),
    },
  };
}
