import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { adAccount, adEntity, dailyMetric } from "../db/schema";
import { addDays, todayInTimezone } from "../lib/dates";
import { DEFAULT_CONFIG, type RuleContext, type Totals } from "./types";

type Account = typeof adAccount.$inferSelect;

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

function windowSums(prefix: string, from: string, to: string) {
  const inWindow = sql`${dailyMetric.date} between ${from} and ${to}`;
  const sum = (col: AnyPgColumn) =>
    sql<number>`coalesce(sum(${col}) filter (where ${inWindow}), 0)::float8`.mapWith(Number);
  return {
    [`${prefix}Impressions`]: sum(dailyMetric.impressions),
    [`${prefix}Clicks`]: sum(dailyMetric.clicks),
    [`${prefix}Spend`]: sum(dailyMetric.spendMicros),
    [`${prefix}Conversions`]: sum(dailyMetric.conversions),
    [`${prefix}Value`]: sum(dailyMetric.conversionValueMicros),
    // Null (not 0) when the platform reports no reach.
    [`${prefix}Reach`]: sql<number | null>`(sum(${dailyMetric.reach}) filter (where ${inWindow}))::float8`.mapWith((v) =>
      v == null ? null : Number(v),
    ),
  } as Record<string, SQL<number | null>>;
}

function totalsFrom(row: Record<string, unknown>, prefix: string): Totals {
  const n = (k: string) => (row[`${prefix}${k}`] as number | null) ?? 0;
  return {
    impressions: n("Impressions"),
    clicks: n("Clicks"),
    spendMicros: n("Spend"),
    conversions: n("Conversions"),
    conversionValueMicros: n("Value"),
    reach: (row[`${prefix}Reach`] as number | null) ?? null,
  };
}

export async function loadRuleContext(db: Db, account: Account, now: Date = new Date()): Promise<RuleContext> {
  const windows = windowsFor(todayInTimezone(account.timezone, now));
  const parent = alias(adEntity, "parent");

  const [entityRows, dailyRows] = await Promise.all([
    db
      .select({
        id: adEntity.id,
        level: adEntity.level,
        name: adEntity.name,
        parentId: adEntity.parentId,
        parentName: parent.name,
        status: adEntity.status,
        dailyBudgetMicros: adEntity.dailyBudgetMicros,
        ...windowSums("r", windows.recentStart, windows.recentEnd),
        ...windowSums("b", windows.baselineStart, windows.baselineEnd),
      })
      .from(adEntity)
      .leftJoin(parent, eq(parent.id, adEntity.parentId))
      .leftJoin(
        dailyMetric,
        and(eq(dailyMetric.entityId, adEntity.id), gte(dailyMetric.date, windows.baselineStart), lte(dailyMetric.date, windows.recentEnd)),
      )
      .where(eq(adEntity.adAccountId, account.id))
      .groupBy(adEntity.id, parent.name),
    db
      .select({ date: dailyMetric.date, ...windowSums("d", windows.baselineStart, windows.recentEnd) })
      .from(dailyMetric)
      .where(
        and(
          eq(dailyMetric.adAccountId, account.id),
          eq(dailyMetric.level, "campaign"),
          gte(dailyMetric.date, windows.baselineStart),
          lte(dailyMetric.date, windows.recentEnd),
        ),
      )
      .groupBy(dailyMetric.date),
  ]);

  const byDate = new Map(dailyRows.map((r) => [r.date, totalsFrom(r, "d")]));
  const accountDaily = [];
  for (let d = windows.baselineStart; d <= windows.recentEnd; d = addDays(d, 1)) {
    accountDaily.push({ date: d, ...(byDate.get(d) ?? { impressions: 0, clicks: 0, spendMicros: 0, conversions: 0, conversionValueMicros: 0, reach: null }) });
  }

  return {
    account: { id: account.id, platform: account.platform, currency: account.currency },
    windows,
    entities: entityRows.map((r) => ({
      id: r.id,
      level: r.level === "account" ? "campaign" : r.level,
      name: r.name,
      parentId: r.parentId,
      parentName: r.parentName,
      status: r.status,
      dailyBudgetMicros: r.dailyBudgetMicros,
      recent: totalsFrom(r, "r"),
      baseline: totalsFrom(r, "b"),
    })),
    accountDaily,
    config: DEFAULT_CONFIG,
  };
}
