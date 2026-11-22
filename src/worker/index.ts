import { Hono } from "hono";
import { createDb } from "./db/client";
import { createAuth } from "./auth";
import type { AppEnv, AuthedEnv } from "./app-env";
import { connections } from "./routes/connections";
import { adAccounts } from "./routes/ad-accounts";
import { recommendations } from "./routes/recommendations";
import { handleScheduled, handleSyncBatch } from "./sync/handlers";
import type { SyncMessage } from "./sync/enqueue";

const app = new Hono<AppEnv>().basePath("/api");

// Per-request DB + auth instances.
app.use("*", async (c, next) => {
  const { db, sql } = createDb(c.env);
  c.set("db", db);
  c.set("auth", createAuth(c.env, db));
  c.set("user", null);
  c.set("session", null);

  try {
    await next();
  } finally {
    // Close the client after the response without blocking it.
    c.executionCtx.waitUntil(sql.end());
  }
});

app.on(["GET", "POST"], "/auth/*", (c) => c.get("auth").handler(c.req.raw));

app.get("/health", async (c) => {
  await c.get("db").execute("select 1");
  return c.json({ ok: true, mockProviders: c.env.USE_MOCK_PROVIDERS === "true" });
});

// Everything below requires a signed-in user.
const authed = new Hono<AuthedEnv>();
authed.use("*", async (c, next) => {
  const result = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!result) return c.json({ error: "unauthorized" }, 401);
  c.set("user", result.user);
  c.set("session", result.session);
  await next();
});

authed.get("/me", (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, email: user.email, name: user.name });
});

authed.route("/connections", connections);
authed.route("/ad-accounts", adAccounts);
authed.route("/recommendations", recommendations);

app.route("/", authed);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
  async queue(batch, env) {
    await handleSyncBatch(batch, env);
  },
} satisfies ExportedHandler<Env, SyncMessage>;
