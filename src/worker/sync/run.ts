import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { adAccount, adConnection, adEntity, dailyMetric, syncRun } from "../db/schema";
import { decryptSecret } from "../lib/crypto";
import { getProvider } from "../providers";
import type { ProviderEntity } from "../providers/types";
import { INSERT_CHUNK, MAX_ATTEMPTS } from "./config";

const excluded = (column: string): SQL => sql.raw(`excluded.${column}`);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

class PermanentSyncError extends Error {}

export type SyncOutcome = "done" | "retry";

/** Execute one queued sync run. Returns "retry" if the queue should redeliver the message. */
export async function runSync(env: Env, db: Db, syncRunId: string): Promise<SyncOutcome> {
  const [run] = await db
    .update(syncRun)
    .set({ status: "running", startedAt: new Date(), attempts: sql`${syncRun.attempts} + 1` })
    .where(and(eq(syncRun.id, syncRunId), sql`${syncRun.status} in ('queued', 'running')`))
    .returning();
  if (!run) return "done"; // Already finished, timed out or deleted.

  try {
    const rows = await syncAccount(env, db, run.adAccountId, { start: run.rangeStart, end: run.rangeEnd });
    const now = new Date();
    await db.update(syncRun).set({ status: "succeeded", rowsUpserted: rows, error: null, finishedAt: now }).where(eq(syncRun.id, run.id));
    await db.update(adAccount).set({ lastSyncedAt: now, updatedAt: now }).where(eq(adAccount.id, run.adAccountId));
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retry = !(err instanceof PermanentSyncError) && run.attempts < MAX_ATTEMPTS;
    console.error(`sync ${run.id} attempt ${run.attempts} failed:`, message);
    await db
      .update(syncRun)
      // Stay "queued" while retrying so the one-active-sync lock is held.
      .set(retry ? { status: "queued", error: message } : { status: "failed", error: message, finishedAt: new Date() })
      .where(eq(syncRun.id, run.id));
    return retry ? "retry" : "done";
  }
}

async function syncAccount(env: Env, db: Db, adAccountId: string, range: { start: string; end: string }): Promise<number> {
  const [row] = await db
    .select({ account: adAccount, connection: adConnection })
    .from(adAccount)
    .innerJoin(adConnection, eq(adConnection.id, adAccount.connectionId))
    .where(eq(adAccount.id, adAccountId));
  if (!row) throw new PermanentSyncError("Ad account no longer exists");
  const { account, connection } = row;
  if (connection.status !== "active") throw new PermanentSyncError(`Connection is ${connection.status}; reconnect required`);
  if (!connection.accessTokenEnc) throw new PermanentSyncError("Connection has no access token");

  const token = await decryptSecret(connection.accessTokenEnc, env.TOKEN_ENCRYPTION_KEY);
  const provider = getProvider(env, account.platform);

  // 1. Entities, parents before children so parent ids are known.
  const entities = await provider.listEntities(token, account.externalId);
  const ids = await upsertEntities(db, account.id, entities);

  // 2. Daily metrics.
  const metrics = await provider.getDailyMetrics(token, account.externalId, range);
  const values = metrics.flatMap((m) => {
    const entityId = ids.get(`${m.level}:${m.externalId}`);
    if (!entityId) return []; // Metric for an entity we didn't receive; skip.
    return [{
      adAccountId: account.id,
      entityId,
      level: m.level,
      date: m.date,
      impressions: m.impressions,
      clicks: m.clicks,
      spendMicros: m.spendMicros,
      conversions: m.conversions,
      conversionValueMicros: m.conversionValueMicros,
      reach: m.reach ?? null,
      videoViews: m.videoViews ?? null,
    }];
  });

  for (const batch of chunk(values, INSERT_CHUNK)) {
    await db
      .insert(dailyMetric)
      .values(batch)
      .onConflictDoUpdate({
        target: [dailyMetric.entityId, dailyMetric.date],
        set: {
          impressions: excluded("impressions"),
          clicks: excluded("clicks"),
          spendMicros: excluded("spend_micros"),
          conversions: excluded("conversions"),
          conversionValueMicros: excluded("conversion_value_micros"),
          reach: excluded("reach"),
          videoViews: excluded("video_views"),
        },
      });
  }
  return values.length;
}

/** Upsert the entity tree level by level; returns `${level}:${externalId}` → id. */
async function upsertEntities(db: Db, adAccountId: string, entities: ProviderEntity[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const parentLevel = { campaign: null, ad_group: "campaign", ad: "ad_group" } as const;

  for (const level of ["campaign", "ad_group", "ad"] as const) {
    const atLevel = entities.filter((e) => e.level === level);
    for (const batch of chunk(atLevel, INSERT_CHUNK)) {
      const rows = await db
        .insert(adEntity)
        .values(
          batch.map((e) => {
            const pl = parentLevel[level];
            return {
              adAccountId,
              level,
              parentId: pl && e.parentExternalId ? ids.get(`${pl}:${e.parentExternalId}`) ?? null : null,
              externalId: e.externalId,
              name: e.name,
              status: e.status,
              objective: e.objective ?? null,
              dailyBudgetMicros: e.dailyBudgetMicros ?? null,
              attributes: e.attributes ?? null,
            };
          }),
        )
        .onConflictDoUpdate({
          target: [adEntity.adAccountId, adEntity.level, adEntity.externalId],
          set: {
            parentId: excluded("parent_id"),
            name: excluded("name"),
            status: excluded("status"),
            objective: excluded("objective"),
            dailyBudgetMicros: excluded("daily_budget_micros"),
            attributes: excluded("attributes"),
            updatedAt: new Date(),
          },
        })
        .returning({ id: adEntity.id, externalId: adEntity.externalId });
      for (const r of rows) ids.set(`${level}:${r.externalId}`, r.id);
    }
  }
  return ids;
}
