import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { adAccount, adEntity, recommendation } from "../db/schema";
import type { AuthedEnv } from "../app-env";
import { isUuid } from "../lib/validate";

const STATUSES = ["open", "accepted", "dismissed", "resolved"] as const;
type Status = (typeof STATUSES)[number];
/** Users can set these; "resolved" is set only by the rules engine. */
const SETTABLE: readonly Status[] = ["open", "accepted", "dismissed"];

const severityRank = sql`case ${recommendation.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`;

export const recommendations = new Hono<AuthedEnv>()
  /** List recommendations across the user's accounts. Query: status (default open), adAccountId. */
  .get("/", async (c) => {
    const db = c.get("db");
    const { status = "open", adAccountId } = c.req.query();
    if (!(STATUSES as readonly string[]).includes(status)) return c.json({ error: "invalid status" }, 400);
    if (adAccountId && !isUuid(adAccountId)) return c.json({ error: "invalid adAccountId" }, 400);

    const scope = and(
      eq(adAccount.userId, c.get("user").id),
      adAccountId ? eq(recommendation.adAccountId, adAccountId) : undefined,
    );

    const [items, counts] = await Promise.all([
      db
        .select({
          id: recommendation.id,
          adAccountId: recommendation.adAccountId,
          accountName: adAccount.name,
          platform: adAccount.platform,
          currency: adAccount.currency,
          entityId: recommendation.entityId,
          entityName: adEntity.name,
          entityLevel: adEntity.level,
          source: recommendation.source,
          ruleId: recommendation.ruleId,
          severity: recommendation.severity,
          title: recommendation.title,
          body: recommendation.body,
          evidence: recommendation.evidence,
          estimatedImpact: recommendation.estimatedImpact,
          status: recommendation.status,
          createdAt: recommendation.createdAt,
          updatedAt: recommendation.updatedAt,
        })
        .from(recommendation)
        .innerJoin(adAccount, eq(adAccount.id, recommendation.adAccountId))
        .leftJoin(adEntity, eq(adEntity.id, recommendation.entityId))
        .where(and(scope, eq(recommendation.status, status as Status)))
        .orderBy(severityRank, desc(recommendation.updatedAt))
        .limit(200),
      db
        .select({ status: recommendation.status, count: sql<number>`count(*)::int` })
        .from(recommendation)
        .innerJoin(adAccount, eq(adAccount.id, recommendation.adAccountId))
        .where(scope)
        .groupBy(recommendation.status),
    ]);

    const countMap = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const r of counts) countMap[r.status] = r.count;
    return c.json({ recommendations: items, counts: countMap });
  })

  /** Accept, dismiss or reopen. */
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || !SETTABLE.includes(body.status)) return c.json({ error: `status must be one of ${SETTABLE.join(", ")}` }, 400);

    const db = c.get("db");
    const [row] = await db
      .update(recommendation)
      .set({ status: body.status, updatedAt: new Date() })
      .where(
        and(
          eq(recommendation.id, id),
          sql`${recommendation.adAccountId} in (select ${adAccount.id} from ${adAccount} where ${adAccount.userId} = ${c.get("user").id})`,
        ),
      )
      .returning({ id: recommendation.id, status: recommendation.status });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ recommendation: row });
  });
