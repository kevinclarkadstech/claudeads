import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { adAccount, aiReview, recommendation } from "../db/schema";
import { loadRuleContext } from "../rules/load";
import { evaluate } from "../rules/rules";
import { SNOOZE_DAYS } from "../rules/engine";
import { MAX_ATTEMPTS, STALE_SYNC_MS } from "../sync/config";
import type { QueueMessage } from "../sync/enqueue";
import { aiProviderName, getAnalyst } from "./index";
import { buildAccountSummary } from "./summary";

/** Minimum gap between AI reviews of one account (each one costs money with the real model). */
export const AI_REVIEW_COOLDOWN_MS = 30 * 60 * 1000;

type Account = typeof adAccount.$inferSelect;

export type EnqueueReviewResult =
  | { ok: true; aiReviewId: string }
  | { ok: false; reason: "in_progress" }
  | { ok: false; reason: "no_data" }
  | { ok: false; reason: "cooldown"; retryAt: Date };

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

export async function aiReviewAvailableAt(db: Db, adAccountId: string): Promise<Date | null> {
  const [last] = await db
    .select({ createdAt: aiReview.createdAt })
    .from(aiReview)
    .where(and(eq(aiReview.adAccountId, adAccountId), ne(aiReview.status, "failed")))
    .orderBy(desc(aiReview.createdAt))
    .limit(1);
  if (!last) return null;
  const at = new Date(last.createdAt.getTime() + AI_REVIEW_COOLDOWN_MS);
  return at > new Date() ? at : null;
}

export async function enqueueAiReview(env: Env, db: Db, account: Account): Promise<EnqueueReviewResult> {
  if (!account.lastSyncedAt) return { ok: false, reason: "no_data" };

  await db
    .update(aiReview)
    .set({ status: "failed", error: "Timed out", finishedAt: new Date() })
    .where(
      and(
        eq(aiReview.adAccountId, account.id),
        inArray(aiReview.status, ["queued", "running"]),
        lt(aiReview.createdAt, new Date(Date.now() - STALE_SYNC_MS)),
      ),
    );

  // "Already running" is more useful than a cooldown message while a review is in flight.
  const [active] = await db
    .select({ id: aiReview.id })
    .from(aiReview)
    .where(and(eq(aiReview.adAccountId, account.id), inArray(aiReview.status, ["queued", "running"])))
    .limit(1);
  if (active) return { ok: false, reason: "in_progress" };

  const retryAt = await aiReviewAvailableAt(db, account.id);
  if (retryAt) return { ok: false, reason: "cooldown", retryAt };

  let id: string;
  try {
    const [row] = await db
      .insert(aiReview)
      .values({ adAccountId: account.id, provider: aiProviderName(env) })
      .returning({ id: aiReview.id });
    id = row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "in_progress" };
    throw err;
  }

  try {
    await env.SYNC_QUEUE.send({ type: "ai_review", aiReviewId: id } satisfies QueueMessage);
  } catch (err) {
    await db.update(aiReview).set({ status: "failed", error: "Could not enqueue", finishedAt: new Date() }).where(eq(aiReview.id, id));
    throw err;
  }
  return { ok: true, aiReviewId: id };
}

/** Run one queued review. Returns "retry" for transient failures. */
export async function runAiReview(env: Env, db: Db, aiReviewId: string): Promise<"done" | "retry"> {
  const [review] = await db
    .update(aiReview)
    .set({ status: "running", startedAt: new Date(), attempts: sql`${aiReview.attempts} + 1` })
    .where(and(eq(aiReview.id, aiReviewId), sql`${aiReview.status} in ('queued', 'running')`))
    .returning();
  if (!review) return "done";

  try {
    const [account] = await db.select().from(adAccount).where(eq(adAccount.id, review.adAccountId));
    if (!account) throw new Error("Ad account no longer exists");

    const ctx = await loadRuleContext(db, account);
    const { summary, refs } = buildAccountSummary(ctx, evaluate(ctx), account);
    const analysis = await getAnalyst(env).analyze(summary);

    // Don't re-suggest what the user recently dismissed (same entity + category), mirroring the rules' snooze.
    const snoozed = await db
      .select({ entityId: recommendation.entityId, ruleId: recommendation.ruleId })
      .from(recommendation)
      .where(
        and(
          eq(recommendation.adAccountId, account.id),
          eq(recommendation.source, "ai"),
          eq(recommendation.status, "dismissed"),
          gte(recommendation.updatedAt, new Date(Date.now() - SNOOZE_DAYS * 86_400_000)),
        ),
      );
    const snoozedKeys = new Set(snoozed.map((r) => `${r.ruleId}|${r.entityId ?? ""}`));

    const recs = analysis.output.recommendations
      .slice(0, 5)
      .map((r, i) => ({
      adAccountId: account.id,
      // Only accept refs we issued; anything else becomes account-level.
      entityId: r.entityRef ? refs.get(r.entityRef) ?? null : null,
      source: "ai" as const,
      aiReviewId: review.id,
      ruleId: `ai:${r.category}`,
      severity: r.severity,
      title: r.title,
      body: r.body,
      evidence: { category: r.category, confidence: r.confidence, relatedRules: r.relatedRules, rank: i + 1 },
      estimatedImpact: { note: r.expectedImpact },
      fingerprint: `ai:${review.id}:${i + 1}`,
    }))
      .filter((r) => !snoozedKeys.has(`${r.ruleId}|${r.entityId ?? ""}`));

    await db.transaction(async (tx) => {
      // A new review supersedes earlier AI advice the user hasn't acted on.
      await tx
        .delete(recommendation)
        .where(and(eq(recommendation.adAccountId, account.id), eq(recommendation.source, "ai"), eq(recommendation.status, "open")));
      if (recs.length) await tx.insert(recommendation).values(recs);
      await tx
        .update(aiReview)
        .set({
          status: "succeeded",
          model: analysis.model,
          summary: analysis.output.summary,
          inputTokens: analysis.inputTokens,
          outputTokens: analysis.outputTokens,
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(aiReview.id, review.id));
    });
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ai review ${review.id} attempt ${review.attempts} failed:`, message);
    const retry = review.attempts < MAX_ATTEMPTS && !/declined|not set|no longer exists|format/.test(message);
    await db
      .update(aiReview)
      .set(retry ? { status: "queued", error: message } : { status: "failed", error: message, finishedAt: new Date() })
      .where(eq(aiReview.id, review.id));
    return retry ? "retry" : "done";
  }
}
