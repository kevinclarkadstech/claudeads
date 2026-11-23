import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { adAccount, recommendation } from "../db/schema";
import { loadRuleContext } from "./load";
import { evaluate } from "./rules";
import { fingerprintOf } from "./fingerprint";

/** Days a dismissed/accepted recommendation stays closed before the same issue can reopen it. */
export const SNOOZE_DAYS = 14;

export { fingerprintOf } from "./fingerprint";

export interface RulesResult {
  findings: number;
  opened: number;
  resolved: number;
}

/**
 * Evaluate all rules for an account and reconcile with stored recommendations:
 * - new issue → insert (open)
 * - still-open issue → refresh numbers/text
 * - dismissed/accepted issue → left alone for SNOOZE_DAYS, then reopened if still present
 * - open issue no longer detected → resolved
 */
export async function runRules(db: Db, adAccountId: string, now: Date = new Date()): Promise<RulesResult> {
  const [account] = await db.select().from(adAccount).where(eq(adAccount.id, adAccountId));
  if (!account) return { findings: 0, opened: 0, resolved: 0 };

  const ctx = await loadRuleContext(db, account, now);
  const findings = evaluate(ctx);
  const snoozeCutoff = new Date(now.getTime() - SNOOZE_DAYS * 86_400_000);
  let opened = 0;

  if (findings.length > 0) {
    const rows = await db
      .insert(recommendation)
      .values(
        findings.map((f) => ({
          adAccountId,
          entityId: f.entityId,
          source: "rule" as const,
          ruleId: f.ruleId,
          severity: f.severity,
          title: f.title,
          body: f.body,
          evidence: f.evidence,
          estimatedImpact: f.estimatedImpact,
          fingerprint: fingerprintOf(f),
        })),
      )
      .onConflictDoUpdate({
        target: [recommendation.adAccountId, recommendation.fingerprint],
        set: {
          severity: sql`excluded.severity`,
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          evidence: sql`excluded.evidence`,
          estimatedImpact: sql`excluded.estimated_impact`,
          status: "open",
          updatedAt: now,
        },
        // Snoozed rows (recently dismissed/accepted) are left untouched so their snooze clock keeps running.
        setWhere: sql`not (${recommendation.status} in ('accepted', 'dismissed') and ${recommendation.updatedAt} >= ${snoozeCutoff.toISOString()})`,
      })
      // xmax = 0 identifies freshly inserted rows (vs. updated ones) in Postgres.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    opened = rows.filter((r) => r.inserted).length;
  }

  // Close rule-based recommendations whose condition has cleared.
  const live = findings.map(fingerprintOf);
  const resolved = await db
    .update(recommendation)
    .set({ status: "resolved", updatedAt: now })
    .where(
      and(
        eq(recommendation.adAccountId, adAccountId),
        eq(recommendation.source, "rule"),
        eq(recommendation.status, "open"),
        live.length ? notInArray(recommendation.fingerprint, live) : undefined,
      ),
    )
    .returning({ id: recommendation.id });

  return { findings: findings.length, opened, resolved: resolved.length };
}
