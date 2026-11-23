import { afterEach, describe, expect, it, vi } from "vitest";
import { app, type PublicEnv } from "../src/public/worker";

/** Minimal in-memory D1 stand-in covering the statements the public Worker runs. */
function fakeD1() {
  const waitlist = new Map<string, unknown[]>();
  const events: unknown[][] = [];
  const stmt = (sql: string) => {
    let args: unknown[] = [];
    const s = {
      bind: (...a: unknown[]) => ((args = a), s),
      run: async () => {
        if (sql.includes("INSERT INTO waitlist")) {
          const email = String(args[0]).toLowerCase();
          if (waitlist.has(email)) return { meta: { changes: 0 } };
          waitlist.set(email, args);
          return { meta: { changes: 1 } };
        }
        if (sql.includes("INSERT INTO funnel_event")) events.push(args);
        return { meta: { changes: 1 } };
      },
    };
    return s;
  };
  const db = { prepare: stmt, batch: async () => [] } as unknown as D1Database;
  return { db, waitlist, events };
}

const env = (over: Partial<PublicEnv> = {}) => {
  const d1 = fakeD1();
  return { d1, env: { DB: d1.db, TURNSTILE_SITE_KEY: "", META_PIXEL_ID: "", CONTACT_EMAIL: "hi@x.test", ...over } as PublicEnv };
};

const post = (path: string, body: unknown, e: PublicEnv) =>
  app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, e);

afterEach(() => vi.unstubAllGlobals());

describe("public worker", () => {
  it("exposes public config only", async () => {
    const { env: e } = env({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret", META_PIXEL_ID: "123" });
    const body = await (await app.request("/api/config", {}, e)).json();
    expect(body).toEqual({ turnstileSiteKey: "site", metaPixelId: "123", contactEmail: "hi@x.test" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("validates and stores waitlist signups, deduplicating by email", async () => {
    const { d1, env: e } = env();
    expect((await post("/api/waitlist", { email: "bad" }, e)).status).toBe(400);
    const ok = await post("/api/waitlist", { email: " Ann@Shop.com ", role: "agency", platforms: ["meta", "x"], attribution: { utm_source: "fb" } }, e);
    expect(await ok.json()).toEqual({ ok: true, alreadyOnList: false });
    const row = d1.waitlist.get("ann@shop.com")!;
    expect(row[1]).toBe("agency");
    expect(row[3]).toBe("meta");
    expect(row[4]).toBe("fb");
    expect(await (await post("/api/waitlist", { email: "ANN@shop.com" }, e)).json()).toEqual({ ok: true, alreadyOnList: true });
  });

  it("requires a valid Turnstile token when enabled", async () => {
    const { env: e } = env({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" });
    const verify = vi.fn(async (_url: string, init: RequestInit) => {
      const token = (init.body as FormData).get("response");
      return new Response(JSON.stringify({ success: token === "good" }));
    });
    vi.stubGlobal("fetch", verify);
    expect((await post("/api/waitlist", { email: "a@b.co" }, e)).status).toBe(400);
    expect((await post("/api/waitlist", { email: "a@b.co", turnstileToken: "bad" }, e)).status).toBe(400);
    expect((await post("/api/waitlist", { email: "a@b.co", turnstileToken: "good" }, e)).status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(2); // no call without a token
  });

  it("fails closed if Turnstile is enabled without its secret", async () => {
    const { env: e } = env({ TURNSTILE_SITE_KEY: "site" });
    expect((await post("/api/waitlist", { email: "a@b.co", turnstileToken: "t" }, e)).status).toBe(500);
  });

  it("records only known funnel events", async () => {
    const { d1, env: e } = env();
    expect((await post("/api/events", { name: "demo_start", sessionId: "s" }, e)).status).toBe(204);
    expect((await post("/api/events", { name: "anything" }, e)).status).toBe(400);
    expect(d1.events).toHaveLength(1);
  });
});
