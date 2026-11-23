import { desc, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { syncRun } from "../db/schema";

/** Most recent sync run per account. */
export function latestRunsFor(db: Db, accountIds: string[]) {
  if (accountIds.length === 0) return Promise.resolve([] as (typeof syncRun.$inferSelect)[]);
  return db
    .selectDistinctOn([syncRun.adAccountId])
    .from(syncRun)
    .where(inArray(syncRun.adAccountId, accountIds))
    .orderBy(syncRun.adAccountId, desc(syncRun.createdAt));
}

/** Client-safe view of a sync run. */
export function publicRun(run: typeof syncRun.$inferSelect | undefined) {
  if (!run) return null;
  const { id, status, trigger, rangeStart, rangeEnd, rowsUpserted, error, createdAt, startedAt, finishedAt } = run;
  return { id, status, trigger, rangeStart, rangeEnd, rowsUpserted, error, createdAt, startedAt, finishedAt };
}
