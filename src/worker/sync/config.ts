/**
 * Days fetched on an account's first sync. Covers a 30-day view plus its comparison period,
 * and the rules' 28-day baseline + 7-day window.
 */
export const BACKFILL_DAYS = 60;
/** Days re-fetched on every later sync: platforms restate conversions for days afterwards (attribution). */
export const RESYNC_DAYS = 7;
/** Minimum gap between manual syncs of one account. */
export const MANUAL_COOLDOWN_MS = 10 * 60 * 1000;
/** A queued/running sync older than this is presumed dead and stops blocking new ones. */
export const STALE_SYNC_MS = 30 * 60 * 1000;
/** Must match `max_retries` in wrangler.jsonc. */
export const MAX_ATTEMPTS = 4; // first try + 3 retries
/** Rows per INSERT; keeps well under Postgres' 65,535 bind-parameter limit. */
export const INSERT_CHUNK = 1000;
