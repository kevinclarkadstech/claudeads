/**
 * Public-site Worker (landing page + in-browser demo + waitlist).
 * The SPA is served as static assets; this Worker only handles /api/*.
 * Storage: one D1 database, tables created on first use (no migration step).
 */
import { Hono } from "hono";

export interface PublicEnv {
  DB: D1Database;
  /** Cloudflare Turnstile. Leave the site key empty to disable (local dev). */
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Meta Pixel id; empty disables the pixel. */
  META_PIXEL_ID: string;
  CONTACT_EMAIL: string;
}

export const ROLES = ["business_owner", "in_house_marketer", "agency", "freelancer", "other"] as const;
export const SPEND = ["under_1k", "1k_5k", "5k_25k", "25k_100k", "100k_plus"] as const;
export const PLATFORMS = ["meta", "google", "other"] as const;
/** Funnel events the site may record. Anything else is rejected. */
export const EVENTS = ["landing_view", "demo_start", "demo_ai_run", "waitlist_view"] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS waitlist (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     role TEXT, monthly_spend TEXT, platforms TEXT,
     utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
     referrer TEXT, landing_path TEXT, tried_demo INTEGER NOT NULL DEFAULT 0, country TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS funnel_event (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL, session_id TEXT,
     utm_source TEXT, utm_campaign TEXT, utm_content TEXT, country TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS funnel_event_name_created ON funnel_event (name, created_at)`,
];

let schemaReady: Promise<unknown> | null = null;
function ensureSchema(db: D1Database) {
  schemaReady ??= db.batch(SCHEMA.map((q) => db.prepare(q))).catch((err) => {
    schemaReady = null; // retry on the next request
    throw err;
  });
  return schemaReady;
}

type Attribution = Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term" | "referrer" | "landing_path", string>>;

/** Trim and cap untrusted strings. */
const clean = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function attributionOf(v: unknown): Attribution {
  const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Attribution = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer", "landing_path"] as const) {
    const val = clean(a[k], k === "referrer" ? 500 : 200);
    if (val) out[k] = val;
  }
  return out;
}

async function verifyTurnstile(env: PublicEnv, token: unknown, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SITE_KEY) return true; // disabled (local dev)
  if (!env.TURNSTILE_SECRET_KEY) throw new Error("TURNSTILE_SECRET_KEY is not set");
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

export const app = new Hono<{ Bindings: PublicEnv }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

app.get("/config", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
    metaPixelId: c.env.META_PIXEL_ID || null,
    contactEmail: c.env.CONTACT_EMAIL,
  });
});

app.post("/waitlist", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const email = clean(body.email, 254)?.toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email", message: "Please enter a valid email address." }, 400);
  const role = (ROLES as readonly string[]).includes(String(body.role)) ? String(body.role) : null;
  const spend = (SPEND as readonly string[]).includes(String(body.monthlySpend)) ? String(body.monthlySpend) : null;
  const platforms = Array.isArray(body.platforms)
    ? [...new Set(body.platforms.map(String).filter((p) => (PLATFORMS as readonly string[]).includes(p)))].join(",")
    : null;

  if (!(await verifyTurnstile(c.env, body.turnstileToken, c.req.header("CF-Connecting-IP") ?? null))) {
    return c.json({ error: "verification_failed", message: "Verification failed. Please try again." }, 400);
  }

  await ensureSchema(c.env.DB);
  const a = attributionOf(body.attribution);
  const result = await c.env.DB.prepare(
    `INSERT INTO waitlist (email, role, monthly_spend, platforms, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                           referrer, landing_path, tried_demo, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO NOTHING`,
  )
    .bind(
      email, role, spend, platforms || null,
      a.utm_source ?? null, a.utm_medium ?? null, a.utm_campaign ?? null, a.utm_content ?? null, a.utm_term ?? null,
      a.referrer ?? null, a.landing_path ?? null, body.triedDemo === true ? 1 : 0,
      c.req.header("CF-IPCountry") ?? null,
    )
    .run();

  return c.json({ ok: true, alreadyOnList: result.meta.changes === 0 });
});

app.post("/events", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = String(body?.name ?? "");
  if (!(EVENTS as readonly string[]).includes(name)) return c.json({ error: "unknown_event" }, 400);
  await ensureSchema(c.env.DB);
  const a = attributionOf(body?.attribution);
  await c.env.DB.prepare(
    "INSERT INTO funnel_event (name, session_id, utm_source, utm_campaign, utm_content, country) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(name, clean(body?.sessionId, 64), a.utm_source ?? null, a.utm_campaign ?? null, a.utm_content ?? null, c.req.header("CF-IPCountry") ?? null)
    .run();
  return c.body(null, 204);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal_error" }, 500);
});

export default { fetch: app.fetch } satisfies ExportedHandler<PublicEnv>;
