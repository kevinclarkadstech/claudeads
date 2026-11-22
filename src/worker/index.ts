import { Hono } from "hono";
import { createDb, type Db } from "./db/client";
import { createAuth, type Auth, type AuthSession } from "./auth";

type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
    auth: Auth;
    user: AuthSession["user"] | null;
    session: AuthSession["session"] | null;
  };
};

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
const authed = new Hono<AppEnv>();
authed.use("*", async (c, next) => {
  const result = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!result) return c.json({ error: "unauthorized" }, 401);
  c.set("user", result.user);
  c.set("session", result.session);
  await next();
});

authed.get("/me", (c) => {
  const user = c.get("user")!;
  return c.json({ id: user.id, email: user.email, name: user.name });
});

app.route("/", authed);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
