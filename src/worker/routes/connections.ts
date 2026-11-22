import { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { adAccount, adConnection } from "../db/schema";
import { encryptSecret } from "../lib/crypto";
import { getProvider, isPlatform } from "../providers";
import type { AuthedEnv } from "../app-env";
import { isUuid } from "../lib/validate";

const STATE_TTL_SECONDS = 600;

type OAuthState = { userId: string; platform: string };

function redirectUri(env: Env, platform: string) {
  return `${env.APP_URL}/api/connections/${platform}/callback`;
}

export const connections = new Hono<AuthedEnv>()
  /** All of the user's connections with their ad accounts. */
  .get("/", async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const rows = await db.query.adConnection.findMany({
      where: eq(adConnection.userId, user.id),
      orderBy: asc(adConnection.createdAt),
      columns: { accessTokenEnc: false, refreshTokenEnc: false },
      with: { adAccounts: { orderBy: asc(adAccount.name) } },
    });
    return c.json({ mockMode: c.env.USE_MOCK_PROVIDERS === "true", connections: rows });
  })

  /** Begin OAuth: store a one-time state and redirect to the provider's consent screen. */
  .get("/:platform/start", async (c) => {
    const platform = c.req.param("platform");
    if (!isPlatform(platform)) return c.json({ error: "unknown_platform" }, 404);

    const state = crypto.randomUUID();
    const value: OAuthState = { userId: c.get("user").id, platform };
    await c.env.OAUTH_STATE.put(`state:${state}`, JSON.stringify(value), { expirationTtl: STATE_TTL_SECONDS });

    const provider = getProvider(c.env, platform);
    return c.redirect(provider.getAuthorizationUrl({ state, redirectUri: redirectUri(c.env, platform) }));
  })

  /** OAuth callback: verify state, exchange code, store encrypted tokens, import ad accounts. */
  .get("/:platform/callback", async (c) => {
    const platform = c.req.param("platform");
    const fail = (reason: string) => c.redirect(`/?connect_error=${encodeURIComponent(reason)}`);
    if (!isPlatform(platform)) return fail("unknown_platform");

    const { code, state, error } = c.req.query();
    if (error) return fail(error);
    if (!code || !state) return fail("missing_code");

    const key = `state:${state}`;
    const raw = await c.env.OAUTH_STATE.get(key);
    await c.env.OAUTH_STATE.delete(key);
    const saved = raw ? (JSON.parse(raw) as OAuthState) : null;
    const user = c.get("user");
    if (!saved || saved.userId !== user.id || saved.platform !== platform) return fail("invalid_state");

    const provider = getProvider(c.env, platform);
    const tokens = await provider.exchangeCode({ code, redirectUri: redirectUri(c.env, platform) });
    const key32 = c.env.TOKEN_ENCRYPTION_KEY;
    const accessTokenEnc = await encryptSecret(tokens.accessToken, key32);
    const refreshTokenEnc = tokens.refreshToken ? await encryptSecret(tokens.refreshToken, key32) : null;

    const db = c.get("db");
    const [conn] = await db
      .insert(adConnection)
      .values({
        userId: user.id,
        platform,
        externalUserId: tokens.externalUserId,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt: tokens.expiresAt ?? null,
        scopes: tokens.scopes,
        status: "active",
        isMock: provider.isMock,
      })
      .onConflictDoUpdate({
        target: [adConnection.userId, adConnection.platform, adConnection.externalUserId],
        set: {
          accessTokenEnc,
          refreshTokenEnc,
          accessTokenExpiresAt: tokens.expiresAt ?? null,
          scopes: tokens.scopes,
          status: "active",
          isMock: provider.isMock,
          updatedAt: new Date(),
        },
      })
      .returning({ id: adConnection.id });

    const accounts = await provider.listAdAccounts(tokens.accessToken);
    if (accounts.length > 0) {
      await db
        .insert(adAccount)
        .values(
          accounts.map((a) => ({
            connectionId: conn!.id,
            userId: user.id,
            platform,
            externalId: a.externalId,
            name: a.name,
            currency: a.currency,
            timezone: a.timezone,
          })),
        )
        .onConflictDoUpdate({
          target: [adAccount.connectionId, adAccount.externalId],
          set: { name: sqlExcluded("name"), currency: sqlExcluded("currency"), timezone: sqlExcluded("timezone"), updatedAt: new Date() },
        });
    }

    return c.redirect(`/?connected=${platform}`);
  })

  /** Disconnect: deletes the connection and (via cascade) its accounts and data. */
  .delete("/:id", async (c) => {
    if (!isUuid(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    const db = c.get("db");
    const deleted = await db
      .delete(adConnection)
      .where(and(eq(adConnection.id, c.req.param("id")), eq(adConnection.userId, c.get("user").id)))
      .returning({ id: adConnection.id });
    if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
