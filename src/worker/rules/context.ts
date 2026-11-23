/**
 * Pure (database-free) helpers for building a RuleContext. Shared by the SQL loader,
 * the in-browser demo and the tests.
 */
import { addDays } from "../lib/dates";
import type { ProviderDailyMetric, ProviderEntity } from "../providers/types";
import { sumTotals } from "./rules";
import { DEFAULT_CONFIG, type EntityStats, type RuleContext, type Totals } from "./types";

/**
 * Windows end yesterday (in the account's timezone): today's numbers are partial and
 * would make every metric look like it dropped.
 */
export function windowsFor(today: string) {
  const recentEnd = addDays(today, -1);
  return {
    recentStart: addDays(recentEnd, -6),
    recentEnd,
    baselineStart: addDays(recentEnd, -34),
    baselineEnd: addDays(recentEnd, -7),
  };
}

export const toTotals = (m: ProviderDailyMetric): Totals => ({
  impressions: m.impressions,
  clicks: m.clicks,
  spendMicros: m.spendMicros,
  conversions: m.conversions,
  conversionValueMicros: m.conversionValueMicros,
  reach: m.reach ?? null,
});

/**
 * Build a RuleContext from provider-shaped entities and daily rows (in memory).
 * `idOf` maps an external id to the id used in findings (defaults to the external id).
 */
export function contextFromProviderData(opts: {
  account: RuleContext["account"];
  today: string;
  entities: ProviderEntity[];
  rows: ProviderDailyMetric[];
  idOf?: (externalId: string) => string;
}): RuleContext {
  const w = windowsFor(opts.today);
  const idOf = opts.idOf ?? ((x: string) => x);
  const names = new Map(opts.entities.map((e) => [e.externalId, e.name]));

  // Bucket rows once: external id -> rows within the windows.
  const byEntity = new Map<string, ProviderDailyMetric[]>();
  for (const r of opts.rows) {
    if (r.date < w.baselineStart || r.date > w.recentEnd) continue;
    let list = byEntity.get(r.externalId);
    if (!list) byEntity.set(r.externalId, (list = []));
    list.push(r);
  }
  const win = (rows: ProviderDailyMetric[], a: string, b: string) =>
    sumTotals(rows.filter((r) => r.date >= a && r.date <= b).map(toTotals));

  const entities: EntityStats[] = opts.entities.map((e) => {
    const mine = byEntity.get(e.externalId) ?? [];
    return {
      id: idOf(e.externalId),
      level: e.level,
      name: e.name,
      parentId: e.parentExternalId ? idOf(e.parentExternalId) : null,
      parentName: e.parentExternalId ? names.get(e.parentExternalId) ?? null : null,
      status: e.status,
      dailyBudgetMicros: e.dailyBudgetMicros ?? null,
      recent: win(mine, w.recentStart, w.recentEnd),
      baseline: win(mine, w.baselineStart, w.baselineEnd),
    };
  });

  const campaignRowsByDate = new Map<string, Totals[]>();
  for (const r of opts.rows) {
    if (r.level !== "campaign") continue;
    let list = campaignRowsByDate.get(r.date);
    if (!list) campaignRowsByDate.set(r.date, (list = []));
    list.push(toTotals(r));
  }
  const accountDaily = [];
  for (let d = w.baselineStart; d <= w.recentEnd; d = addDays(d, 1)) {
    accountDaily.push({ date: d, ...sumTotals(campaignRowsByDate.get(d) ?? []) });
  }

  return { account: opts.account, windows: w, entities, accountDaily, config: DEFAULT_CONFIG };
}
