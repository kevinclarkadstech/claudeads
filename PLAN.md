# ClaudeAds — Build Plan

A multi-tenant SaaS on Cloudflare where users sign in, connect their **Meta** and **Google Ads**
accounts (read-only), and get **recommendations** from deterministic rules and an AI layer.
Later: **Gemini**-generated creative drafts.

Users act on recommendations themselves, in the ad platforms. We never write to their ad accounts,
which keeps OAuth scopes minimal (`ads_read` and the read-only use of `adwords`).

---

## 1. Strategy: mock first, validate the market

Production access to both ad APIs is gated:

| Platform | What's needed for *other people's* accounts | Needs a registered business? |
|---|---|---|
| Meta | Business Verification + App Review for Advanced Access to `ads_read` | **Yes**, in practice (legal name, address, registration docs) |
| Google | Ads API developer token at **Basic Access** + OAuth consent-screen verification (`adwords` is a sensitive scope) | No formal entity requirement, but needs a domain, privacy policy, homepage |

So the plan is to build the whole product against a **mock provider** that implements the same
`AdsProvider` interface (`src/worker/providers/types.ts`) as the real adapters. It generates realistic,
deterministic (seeded) accounts, campaigns, ad sets, ads and daily metrics, including built-in
problems (a CPA spike, creative fatigue, a budget-capped winner, a zero-conversion ad set) so the
rules and AI output make sense. This is enough for demos, a waitlist and customer interviews.
Swap in the real adapters once the business entity and approvals exist. `USE_MOCK_PROVIDERS` controls this.

Things that can start before forming an entity:
- Meta: create a developer app and use **Standard Access** against *your own* ad accounts.
- Google: apply for a test developer token from a manager (MCC) account and use test accounts.

---

## 2. Architecture

```
Browser (React SPA)
   │  same origin
   ▼
Cloudflare Worker (Hono) ── Better Auth (email+password; social later)
   │        │         │
   │        │         └── AI Gateway ─► Claude (analysis) / Gemini (creatives, later)
   │        └── Queues ◄── Cron Trigger (nightly sync fan-out)
   ▼
Hyperdrive ─► Neon Postgres (Drizzle ORM)
R2: raw API payloads, generated creatives   KV: OAuth state, small caches
```

- **Frontend:** React 19 + React Router, Vite, served by Workers Static Assets (`/api/*` hits the Worker first).
- **API:** Hono on one Worker; Better Auth mounted at `/api/auth/*`.
- **DB:** Neon Postgres through Hyperdrive, with Drizzle schema and migrations (`drizzle/`).
  - Sessions live in Postgres. Better Auth's *secondary storage* needs atomic increment and
    get-and-delete, which KV lacks. The signed **cookie cache** (5 min) avoids most session reads.
- **Background:** a Cron Trigger enqueues one Queue message per selected ad account; the consumer syncs and then runs rules.
- **Secrets:** `BETTER_AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` (AES-256-GCM for platform tokens, `lib/crypto.ts`).

---

## 3. Data model (`src/worker/db/schema`)

| Table | Purpose |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth |
| `ad_connection` | One OAuth grant per user per platform; encrypted tokens; `is_mock` |
| `ad_account` | Meta `act_…` / Google customer id; `is_selected` for syncing |
| `ad_entity` | Campaign → ad group (ad set) → ad, self-referencing, platform-neutral |
| `daily_metric` | Per entity per day: impressions, clicks, spend (micros), conversions, value (micros), reach |
| `sync_run` | Sync audit and status |
| `recommendation` | Rule or AI output, severity, evidence JSON, open/accepted/dismissed, dedup `fingerprint` |

Money is stored as **integer micros**. Derived metrics (CTR, CPC, CPA, ROAS, frequency) are computed
at query time, not stored.

**Scale note:** `daily_metric` is the big table. If it grows into the hundreds of millions of rows,
partition by month (Postgres native partitioning) and/or keep ad-level rows for 13 months.

**Tenancy:** data is scoped by `user_id` for the MVP. Before agency/team features, add Better Auth's
`organization` plugin and move ownership to `organization_id`.

---

## 4. API routes

| Method | Route | Milestone |
|---|---|---|
| `*` | `/api/auth/*` (Better Auth) | 1 ✅ |
| GET | `/api/health` | 1 ✅ |
| GET | `/api/me` | 1 ✅ |
| GET | `/api/connections` | 2 ✅ |
| GET | `/api/connections/:platform/start` → redirect to consent (mock: instant) | 2 ✅ |
| GET | `/api/connections/:platform/callback` | 2 ✅ |
| DELETE | `/api/connections/:id` | 2 ✅ |
| GET | `/api/ad-accounts` · PATCH `/api/ad-accounts/:id` (select) | 2 ✅ |
| POST | `/api/ad-accounts/:id/sync` | 3 |
| GET | `/api/ad-accounts/:id/metrics?level=&from=&to=` | 3 |
| GET | `/api/ad-accounts/:id/entities` | 3 |
| GET | `/api/recommendations?status=` · PATCH `/api/recommendations/:id` | 4 |
| POST | `/api/ad-accounts/:id/ai-review` | 5 |
| POST | `/api/creatives/generate` | 7 |

---

## 5. Analysis

### Deterministic rules (run after each sync)
Each rule is a pure function `(metrics, entities, account settings) → Recommendation[]` with a stable fingerprint.

1. **CPA spike:** 7-day CPA ≥ 30% above the prior 28-day baseline, with minimum spend and conversions.
2. **Creative fatigue (Meta):** frequency > 4 and CTR down ≥ 25% vs. the first week of the ad's life.
3. **Wasted spend:** ad set or ad with spend ≥ 2× target CPA and zero conversions.
4. **Budget-limited winner:** ROAS well above the account average while spending near its full daily budget.
5. **Low CTR outlier:** CTR < 50% of the account median at the same level (minimum impressions).
6. **Tracking anomaly:** conversions drop to ~0 account-wide while clicks hold steady.

Thresholds are per-account settings with sensible defaults.

### AI layer (Claude, on demand and weekly)
Input: a compact JSON summary (top entities, trends, fired rules, the account's goal and target CPA/ROAS).
We never send raw dumps. Output: structured JSON recommendations (title, rationale, evidence refs,
expected impact, confidence), validated with a schema and stored with `source = 'ai'`.
Routed through AI Gateway for logging, caching and spend caps.

### Creatives (Gemini, after the MVP)
Given an ad's copy and image, its metrics and a recommendation (e.g. fatigue), generate N headline and
body variants plus image variations. Users download or copy them. Nothing is uploaded to the platforms.

---

## 6. Milestones

1. **Scaffold** ✅: Vite + React + Hono Worker, Better Auth (email/password), Drizzle schema plus first migration, Hyperdrive config, local Postgres.
2. **Connections (mock)** ✅: deterministic mock provider for both platforms (`providers/mock.ts`, with the anomalies from §1), the OAuth flow (one-time `state` in KV, encrypted tokens, account import), and the account picker UI.
   *Deferred:* the real Meta OAuth adapter, until a Meta developer app exists. It only needs to implement `AdsProvider` and be returned by `getProvider()`.
3. **Sync pipeline:** Cron → Queue → consumer; 30-day backfill and then daily upserts; sync status UI; raw payloads to R2.
4. **Rules engine + recommendations feed:** the six rules above, dedup, accept/dismiss.
5. **AI review:** Claude via AI Gateway, structured output, an "AI summary" panel.
6. **Google Ads:** REST plus GAQL adapter into the same normalized tables.
7. **Gemini creative drafts.**
8. **SaaS hardening:** email verification, password reset (needs an email provider), Google sign-in,
   organizations/teams, billing (Stripe), privacy policy and ToS pages, account and data deletion
   (required by Meta and Google).

---

## 7. Deployment checklist (when going live)
1. Create a Neon project and copy the **direct** connection string.
2. `npx wrangler hyperdrive create claudeads-db --connection-string="<neon-url>"`, then put the id in `wrangler.jsonc`.
3. `DATABASE_URL=<neon-url> npm run db:migrate`
4. `npx wrangler secret put BETTER_AUTH_SECRET` and `npx wrangler secret put TOKEN_ENCRYPTION_KEY`
5. Set `APP_URL` to the production origin (a `vars` override or `env.production`).
6. `npm run deploy`
