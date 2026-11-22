import { Hono } from "hono";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { adAccount, adEntity, dailyMetric } from "../db/schema";
import type { AuthedEnv } from "../app-env";
import { isUuid } from "../lib/validate";
import { addDays, isIsoDate, todayInTimezone } from "../lib/dates";
import { enqueueSync, manualSyncAvailableAt } from "../sync/enqueue";
import { latestRunsFor, publicRun } from "../sync/status";
import { aiReviewAvailableAt, enqueueAiReview } from "../ai/review";
import { aiProviderName } from "../ai";
import { aiReview } from "../db/schema";

const LEVELS = ["campaign", "ad_group", "ad"] as const;
type Level = (typeof LEVELS)[number];
const MAX_RANGE_DAYS = 180;

async function findOwnedAccount(db: Db, id: string, userId: string) {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(adAccount).where(and(eq(adAccount.id, id), eq(adAccount.userId, userId)));
  return row ?? null;
}

/** Summed metric columns, as numbers (Postgres returns numeric for sum(bigint)). */
const sums = {
  impressions: sql<number>`coalesce(sum(${dailyMetric.impressions}), 0)::float8`.mapWith(Number),
  clicks: sql<number>`coalesce(sum(${dailyMetric.clicks}), 0)::float8`.mapWith(Number),
  spendMicros: sql<number>`coalesce(sum(${dailyMetric.spendMicros}), 0)::float8`.mapWith(Number),
  conversions: sql<number>`coalesce(sum(${dailyMetric.conversions}), 0)::float8`.mapWith(Number),
  conversionValueMicros: sql<number>`coalesce(sum(${dailyMetric.conversionValueMicros}), 0)::float8`.mapWith(Number),
  reach: sql<number | null>`sum(${dailyMetric.reach})::float8`.mapWith((v) => (v == null ? null : Number(v))),
};
type Totals = { [K in keyof typeof sums]: (typeof sums)[K]["_"]["type"] };
const zeroTotals = (): Totals => ({ impressions: 0, clicks: 0, spendMicros: 0, conversions: 0, conversionValueMicros: 0, reach: null });

export const adAccounts = new Hono<AuthedEnv>()
  .get("/", async (c) => {
    const db = c.get("db");
    const rows = await db
      .select()
      .from(adAccount)
      .where(eq(adAccount.userId, c.get("user").id))
      .orderBy(asc(adAccount.platform), asc(adAccount.name));
    const runs = await latestRunsFor(db, rows.map((r) => r.id));
    const byAccount = new Map(runs.map((r) => [r.adAccountId, r]));
    return c.json({ adAccounts: rows.map((a) => ({ ...a, latestSync: publicRun(byAccount.get(a.id)) })) });
  })

  .get("/:id", async (c) => {
    const db = c.get("db");
    const account = await findOwnedAccount(db, c.req.param("id"), c.get("user").id);
    if (!account) return c.json({ error: "not_found" }, 404);
    const [latest] = await latestRunsFor(db, [account.id]);
    const nextManualSyncAt = await manualSyncAvailableAt(db, account.id);
    return c.json({ adAccount: { ...account, latestSync: publicRun(latest), nextManualSyncAt } });
  })

  /** Toggle whether an account is synced and analyzed. Selecting a never-synced account starts its backfill. */
  .patch("/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.isSelected !== "boolean") return c.json({ error: "isSelected (boolean) required" }, 400);
    const db = c.get("db");
    if (!(await findOwnedAccount(db, c.req.param("id"), c.get("user").id))) return c.json({ error: "not_found" }, 404);

    const [row] = await db
      .update(adAccount)
      .set({ isSelected: body.isSelected, updatedAt: new Date() })
      .where(eq(adAccount.id, c.req.param("id")))
      .returning();

    let syncStarted = false;
    if (row!.isSelected && !row!.lastSyncedAt) {
      const result = await enqueueSync(c.env, db, row!, "initial");
      syncStarted = result.ok;
    }
    return c.json({ adAccount: row, syncStarted });
  })

  /** On-demand sync, limited to one active sync and one manual sync per cooldown window. */
  .post("/:id/sync", async (c) => {
    const db = c.get("db");
    const account = await findOwnedAccount(db, c.req.param("id"), c.get("user").id);
    if (!account) return c.json({ error: "not_found" }, 404);
    if (!account.isSelected) return c.json({ error: "not_selected", message: "Select this account before syncing." }, 400);

    const result = await enqueueSync(c.env, db, account, account.lastSyncedAt ? "manual" : "initial");
    if (result.ok) return c.json({ syncRunId: result.syncRunId }, 202);
    if (result.reason === "in_progress") return c.json({ error: "in_progress", message: "A sync is already running." }, 409);
    const retryAfter = Math.ceil((result.retryAt.getTime() - Date.now()) / 1000);
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "cooldown", message: "Synced recently.", retryAt: result.retryAt }, 429);
  })

  /** Latest AI review (status + summary) and when the next one is allowed. */
  .get("/:id/ai-review", async (c) => {
    const db = c.get("db");
    const account = await findOwnedAccount(db, c.req.param("id"), c.get("user").id);
    if (!account) return c.json({ error: "not_found" }, 404);
    const [latest] = await db
      .select({
        id: aiReview.id,
        status: aiReview.status,
        provider: aiReview.provider,
        model: aiReview.model,
        summary: aiReview.summary,
        error: aiReview.error,
        createdAt: aiReview.createdAt,
        finishedAt: aiReview.finishedAt,
      })
      .from(aiReview)
      .where(eq(aiReview.adAccountId, account.id))
      .orderBy(desc(aiReview.createdAt))
      .limit(1);
    return c.json({
      review: latest ?? null,
      provider: aiProviderName(c.env),
      nextAvailableAt: await aiReviewAvailableAt(db, account.id),
    });
  })

  /** Start an AI review (async). Limited to one at a time and one per cooldown window. */
  .post("/:id/ai-review", async (c) => {
    const db = c.get("db");
    const account = await findOwnedAccount(db, c.req.param("id"), c.get("user").id);
    if (!account) return c.json({ error: "not_found" }, 404);
    const result = await enqueueAiReview(c.env, db, account);
    if (result.ok) return c.json({ aiReviewId: result.aiReviewId }, 202);
    if (result.reason === "no_data") return c.json({ error: "no_data", message: "Sync this account before running an AI review." }, 400);
    if (result.reason === "in_progress") return c.json({ error: "in_progress", message: "An AI review is already running." }, 409);
    c.header("Retry-After", String(Math.ceil((result.retryAt.getTime() - Date.now()) / 1000)));
    return c.json({ error: "cooldown", message: "AI review ran recently.", retryAt: result.retryAt }, 429);
  })

  /**
   * Metrics for a date range: daily account totals, period totals vs. the previous period,
   * and a per-entity breakdown at the requested level.
   * Query: days (1–180, default 30) or from/to (YYYY-MM-DD); level (campaign|ad_group|ad).
   */
  .get("/:id/metrics", async (c) => {
    const db = c.get("db");
    const account = await findOwnedAccount(db, c.req.param("id"), c.get("user").id);
    if (!account) return c.json({ error: "not_found" }, 404);

    const q = c.req.query();
    const level = (q.level ?? "campaign") as Level;
    if (!LEVELS.includes(level)) return c.json({ error: "invalid level" }, 400);

    let to: string, from: string;
    if (q.from || q.to) {
      if (!q.from || !q.to || !isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) {
        return c.json({ error: "from and to must be YYYY-MM-DD with from <= to" }, 400);
      }
      ({ from, to } = q as { from: string; to: string });
    } else {
      const days = Number(q.days ?? 30);
      if (!Number.isInteger(days) || days < 1 || days > MAX_RANGE_DAYS) return c.json({ error: `days must be 1–${MAX_RANGE_DAYS}` }, 400);
      to = todayInTimezone(account.timezone);
      from = addDays(to, -(days - 1));
    }
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    if (days > MAX_RANGE_DAYS) return c.json({ error: `range must be at most ${MAX_RANGE_DAYS} days` }, 400);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(from, -days);

    // Campaign-level rows sum to the account total without double counting.
    const accountRows = and(eq(dailyMetric.adAccountId, account.id), eq(dailyMetric.level, "campaign"));

    const parent = alias(adEntity, "parent");
    const [dailyRows, periodRows, entityRows] = await Promise.all([
      db
        .select({ date: dailyMetric.date, ...sums })
        .from(dailyMetric)
        .where(and(accountRows, gte(dailyMetric.date, from), lte(dailyMetric.date, to)))
        .groupBy(dailyMetric.date)
        .orderBy(dailyMetric.date),
      db
        .select({ period: sql<string>`case when ${dailyMetric.date} >= ${from} then 'current' else 'previous' end`, ...sums })
        .from(dailyMetric)
        .where(and(accountRows, gte(dailyMetric.date, prevFrom), lte(dailyMetric.date, to)))
        .groupBy(sql`1`),
      db
        .select({
          id: adEntity.id,
          name: adEntity.name,
          status: adEntity.status,
          parentId: adEntity.parentId,
          parentName: parent.name,
          dailyBudgetMicros: adEntity.dailyBudgetMicros,
          ...sums,
        })
        .from(adEntity)
        .leftJoin(parent, eq(parent.id, adEntity.parentId))
        .leftJoin(
          dailyMetric,
          and(eq(dailyMetric.entityId, adEntity.id), gte(dailyMetric.date, from), lte(dailyMetric.date, to)),
        )
        .where(and(eq(adEntity.adAccountId, account.id), eq(adEntity.level, level)))
        .groupBy(adEntity.id, parent.name)
        .orderBy(desc(sql`coalesce(sum(${dailyMetric.spendMicros}), 0)`)),
    ]);

    // Fill days with no rows so charts have a continuous axis.
    const byDate = new Map(dailyRows.map(({ date, ...t }) => [date, t]));
    const daily = [];
    for (let d = from; d <= to; d = addDays(d, 1)) daily.push({ date: d, ...(byDate.get(d) ?? zeroTotals()) });

    const period = (p: string) => {
      const row = periodRows.find((r) => r.period === p);
      if (!row) return zeroTotals();
      const { period: _p, ...t } = row;
      return t;
    };

    return c.json({
      range: { from, to, days, previousFrom: prevFrom, previousTo: prevTo },
      currency: account.currency,
      level,
      totals: { current: period("current"), previous: period("previous") },
      daily,
      entities: entityRows,
    });
  });
