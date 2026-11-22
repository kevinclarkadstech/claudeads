import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { adAccount } from "../db/schema";
import type { AuthedEnv } from "../app-env";
import { isUuid } from "../lib/validate";

export const adAccounts = new Hono<AuthedEnv>()
  .get("/", async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(adAccount)
      .where(eq(adAccount.userId, c.get("user").id))
      .orderBy(asc(adAccount.platform), asc(adAccount.name));
    return c.json({ adAccounts: rows });
  })

  /** Toggle whether an account is synced and analyzed. */
  .patch("/:id", async (c) => {
    if (!isUuid(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.isSelected !== "boolean") return c.json({ error: "isSelected (boolean) required" }, 400);

    const [row] = await c
      .get("db")
      .update(adAccount)
      .set({ isSelected: body.isSelected, updatedAt: new Date() })
      .where(and(eq(adAccount.id, c.req.param("id")), eq(adAccount.userId, c.get("user").id)))
      .returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ adAccount: row });
  });
