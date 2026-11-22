# ClaudeAds

Ad analytics and recommendations for Meta and Google Ads, running on Cloudflare Workers.
See **[PLAN.md](./PLAN.md)** for the architecture and roadmap.

## Stack
React + Vite · Hono on Cloudflare Workers · Better Auth · Drizzle ORM · Neon Postgres via Hyperdrive

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

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with the Worker running in workerd |
| `npm run build` | Build the SPA and Worker |
| `npm run deploy` | Build and `wrangler deploy` |
| `npm run typecheck` | `tsc` |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `npm run db:generate` | Create a migration from schema changes |
| `npm run db:migrate` | Apply migrations (uses `DATABASE_URL`, defaults to local) |

## Layout
```
src/client/     React SPA (login, dashboard)
src/worker/     Hono API: auth.ts, db/ (schema + client), lib/crypto.ts, providers/
drizzle/        SQL migrations
```
