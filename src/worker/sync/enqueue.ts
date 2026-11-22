import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { adAccount, syncRun } from "../db/schema";
import { addDays, todayInTimezone } from "../lib/dates";
import { BACKFILL_DAYS, MANUAL_COOLDOWN_MS, RESYNC_DAYS, STALE_SYNC_MS } from "./config";

export type SyncTrigger = "initial" | "scheduled" | "manual";
export type SyncMessage = { type?: "sync"; syncRunId: string };
/** Everything on the background queue. `type` is optional on sync messages for backward compatibility. */
export type QueueMessage = SyncMessage | { type: "ai_review"; aiReviewId: string };

type Account = typeof adAccount.$inferSelect;

export type EnqueueResult =
  | { ok: true; syncRunId: string }
  | { ok: false; reason: "in_progress" }
  | { ok: false; reason: "cooldown"; retryAt: Date };

function isUniqueViolation(err: unknown): boolean {
  // postgres.js error code, possibly wrapped by Drizzle as `cause`.
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** When the next manual sync is allowed, or null if allowed now. */
export async function manualSyncAvailableAt(db: Db, adAccountId: string): Promise<Date | null> {
  const [last] = await db
    .select({ createdAt: syncRun.createdAt })
    .from(syncRun)
    .where(and(eq(syncRun.adAccountId, adAccountId), ne(syncRun.status, "failed")))
    .orderBy(desc(syncRun.createdAt))
    .limit(1);
  if (!last) return null;
  const at = new Date(last.createdAt.getTime() + MANUAL_COOLDOWN_MS);
  return at > new Date() ? at : null;
}

/**
 * Create a sync_run and put it on the queue. Scheduled, initial and manual syncs all go
 * through here, so they share retries, concurrency limits and the one-active-sync rule.
 */
export async function enqueueSync(env: Env, db: Db, account: Account, trigger: SyncTrigger): Promise<EnqueueResult> {
  // Release runs whose worker died without finishing.
  await db
    .update(syncRun)
    .set({ status: "failed", error: "Timed out", finishedAt: new Date() })
    .where(
      and(
        eq(syncRun.adAccountId, account.id),
        inArray(syncRun.status, ["queued", "running"]),
        lt(syncRun.createdAt, new Date(Date.now() - STALE_SYNC_MS)),
      ),
    );

  if (trigger === "manual") {
    // Report "already running" ahead of the cooldown when a sync (e.g. the nightly one) is in flight.
    const [active] = await db
      .select({ id: syncRun.id })
      .from(syncRun)
      .where(and(eq(syncRun.adAccountId, account.id), inArray(syncRun.status, ["queued", "running"])))
      .limit(1);
    if (active) return { ok: false, reason: "in_progress" };
    const retryAt = await manualSyncAvailableAt(db, account.id);
    if (retryAt) return { ok: false, reason: "cooldown", retryAt };
  }

  const today = todayInTimezone(account.timezone);
  const days = account.lastSyncedAt ? RESYNC_DAYS : BACKFILL_DAYS;

  let id: string;
  try {
    const [row] = await db
      .insert(syncRun)
      .values({ adAccountId: account.id, trigger, rangeStart: addDays(today, -(days - 1)), rangeEnd: today })
      .returning({ id: syncRun.id });
    id = row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "in_progress" };
    throw err;
  }

  try {
    await env.SYNC_QUEUE.send({ type: "sync", syncRunId: id } satisfies QueueMessage);
  } catch (err) {
    await db.update(syncRun).set({ status: "failed", error: "Could not enqueue", finishedAt: new Date() }).where(eq(syncRun.id, id));
    throw err;
  }
  return { ok: true, syncRunId: id };
}
