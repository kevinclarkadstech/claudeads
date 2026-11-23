# AstuteAds

Finds the leaks in Meta and Google Ads budgets: daily checks plus AI-ranked recommendations, running on Cloudflare.
See **[PLAN.md](./PLAN.md)** for the architecture and roadmap.

This repo has two deployments:
- **Public site:** the landing page, an instant in-browser demo, and a waitlist (Cloudflare D1). See **[DEPLOY.md](./DEPLOY.md)**.
  The Meta ad test plan is in [marketing/meta-ad-test.md](./marketing/meta-ad-test.md).
- **Full app:** logins, Postgres, ad-account sync, the rules engine and AI review. The instructions below cover it.

## Stack
React + Vite · Hono on Cloudflare Workers · Better Auth · Drizzle ORM · Neon Postgres via Hyperdrive

## Demo mode
- `USE_MOCK_PROVIDERS=true` (the default in `wrangler.jsonc`) makes "Connect Meta / Google" use generated
  sample accounts instead of the real APIs. No platform credentials are needed.
- `AI_PROVIDER=mock` (the default) runs the AI analysis with a local demo analyst. To use Claude, set
  `AI_PROVIDER=anthropic` and put `ANTHROPIC_API_KEY` in `.dev.vars` (locally) or `wrangler secret put` (deployed).

## Local development

Requires Node 22+ and Postgres 16 (Docker is the easiest way to get it).

```bash
npm install
docker compose up -d                 # Postgres on localhost:5432 (claudeads/claudeads)
cp .dev.vars.example .dev.vars       # then fill in both values:
openssl rand -base64 32              #   run once per secret
npm run db:migrate                   # apply Drizzle migrations
npm run dev                          # http://localhost:5173
```

## Syncing locally
Selecting an account queues its first sync automatically; the queue runs locally under `npm run dev`.
To fire the nightly cron by hand: `curl http://localhost:5173/cdn-cgi/handler/scheduled`

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Full app: Vite dev server with the Worker running in workerd |
| `npm run dev:public` / `build:public` / `deploy:public` | Public site (landing page, demo, waitlist) |
| `npm run build` | Build the SPA and Worker |
| `npm run deploy` | Build and `wrangler deploy` |
| `npm run typecheck` | `tsc` |
| `npm test` | Unit tests (Vitest) |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `npm run db:generate` | Create a migration from schema changes |
| `npm run db:migrate` | Apply migrations (uses `DATABASE_URL`, defaults to local) |

## Layout
```
src/client/     React SPA: landing page, demo (demo/ = in-browser API), app pages
src/public/     Public-site Worker (waitlist + funnel events on D1)
src/worker/     Hono API: auth.ts, routes/, db/ (schema + client), lib/, providers/ (mock + interface),
                sync/ (queue consumer, cron, enqueue rules), rules/ (recommendation engine),
                ai/ (AI analysis: summary builder, Claude + mock analysts)
test/           Vitest unit tests
drizzle/        SQL migrations
```
