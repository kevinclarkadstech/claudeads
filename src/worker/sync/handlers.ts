import { and, eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { adAccount, adConnection } from "../db/schema";
import { enqueueSync, type SyncMessage } from "./enqueue";
import { runSync } from "./run";

/** Queue consumer: one message per sync run. */
export async function handleSyncBatch(batch: MessageBatch<SyncMessage>, env: Env): Promise<void> {
  const { db, sql } = createDb(env);
  try {
    for (const msg of batch.messages) {
      try {
        const outcome = await runSync(env, db, msg.body.syncRunId);
        if (outcome === "retry") msg.retry({ delaySeconds: 30 * msg.attempts });
        else msg.ack();
      } catch (err) {
        // Infrastructure failure (e.g. DB down) before the run could record anything.
        console.error("sync message failed", err);
        msg.retry({ delaySeconds: 60 });
      }
    }
  } finally {
    await sql.end();
  }
}

/** Cron: enqueue a sync for every selected account on an active connection. */
export async function handleScheduled(env: Env): Promise<void> {
  const { db, sql } = createDb(env);
  try {
    const accounts = await db
      .select({ account: adAccount })
      .from(adAccount)
      .innerJoin(adConnection, eq(adConnection.id, adAccount.connectionId))
      .where(and(eq(adAccount.isSelected, true), eq(adConnection.status, "active")));

    let queued = 0;
    for (const { account } of accounts) {
      const result = await enqueueSync(env, db, account, account.lastSyncedAt ? "scheduled" : "initial");
      if (result.ok) queued++;
    }
    console.log(`scheduled sync: ${queued}/${accounts.length} accounts queued`);
  } finally {
    await sql.end();
  }
}
