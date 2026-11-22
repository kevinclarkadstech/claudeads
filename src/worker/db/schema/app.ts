// Application tables: ad-platform connections and a platform-neutral data model.
// Money is stored as integer micros (1 USD = 1_000_000) to avoid float drift;
// this matches Google Ads' native unit and is easy to convert from Meta's decimals.
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  bigint,
  integer,
  date,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth";

export const platform = pgEnum("platform", ["meta", "google"]);
export const connectionStatus = pgEnum("connection_status", ["active", "expired", "revoked", "error"]);
export const entityLevel = pgEnum("entity_level", ["account", "campaign", "ad_group", "ad"]);
export const syncStatus = pgEnum("sync_status", ["queued", "running", "succeeded", "failed"]);
export const syncTrigger = pgEnum("sync_trigger", ["initial", "scheduled", "manual"]);
export const recSource = pgEnum("rec_source", ["rule", "ai"]);
export const recSeverity = pgEnum("rec_severity", ["info", "warning", "critical"]);
/** resolved = the rule stopped firing (the issue cleared on its own or was fixed). */
export const recStatus = pgEnum("rec_status", ["open", "accepted", "dismissed", "resolved"]);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/** One OAuth grant from a user to an ad platform (may cover many ad accounts). */
export const adConnection = pgTable(
  "ad_connection",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platform: platform().notNull(),
    externalUserId: text().notNull(),
    /** AES-GCM ciphertext (see lib/crypto.ts). Null for mock connections. */
    accessTokenEnc: text(),
    refreshTokenEnc: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    scopes: text().array(),
    status: connectionStatus().notNull().default("active"),
    isMock: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.userId, t.platform, t.externalUserId)],
);

/** An advertiser account (Meta `act_…` / Google Ads customer id). */
export const adAccount = pgTable(
  "ad_account",
  {
    id: uuid().primaryKey().defaultRandom(),
    connectionId: uuid()
      .notNull()
      .references(() => adConnection.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platform: platform().notNull(),
    externalId: text().notNull(),
    name: text().notNull(),
    currency: text().notNull(),
    timezone: text().notNull(),
    /** User chose to sync/analyze this account. */
    isSelected: boolean().notNull().default(false),
    lastSyncedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.connectionId, t.externalId), index().on(t.userId)],
);

/**
 * Campaigns, ad groups (Meta: ad sets) and ads in one self-referencing table.
 * Keeps the analysis code platform- and level-agnostic.
 */
export const adEntity = pgTable(
  "ad_entity",
  {
    id: uuid().primaryKey().defaultRandom(),
    adAccountId: uuid()
      .notNull()
      .references(() => adAccount.id, { onDelete: "cascade" }),
    level: entityLevel().notNull(),
    parentId: uuid().references((): AnyPgColumn => adEntity.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    name: text().notNull(),
    /** Normalized: active | paused | archived | removed */
    status: text().notNull(),
    objective: text(),
    dailyBudgetMicros: bigint({ mode: "number" }),
    /** Platform-specific extras (bid strategy, creative ids, …). */
    attributes: jsonb().$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.adAccountId, t.level, t.externalId), index().on(t.parentId)],
);

/** Daily performance per entity. The core time-series table. */
export const dailyMetric = pgTable(
  "daily_metric",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    adAccountId: uuid()
      .notNull()
      .references(() => adAccount.id, { onDelete: "cascade" }),
    entityId: uuid()
      .notNull()
      .references(() => adEntity.id, { onDelete: "cascade" }),
    level: entityLevel().notNull(),
    date: date().notNull(),
    impressions: bigint({ mode: "number" }).notNull().default(0),
    clicks: bigint({ mode: "number" }).notNull().default(0),
    spendMicros: bigint({ mode: "number" }).notNull().default(0),
    conversions: doublePrecision().notNull().default(0),
    conversionValueMicros: bigint({ mode: "number" }).notNull().default(0),
    /** Meta only; null for Google. */
    reach: bigint({ mode: "number" }),
    videoViews: bigint({ mode: "number" }),
    extra: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex().on(t.entityId, t.date),
    index().on(t.adAccountId, t.level, t.date),
  ],
);

export const syncRun = pgTable(
  "sync_run",
  {
    id: uuid().primaryKey().defaultRandom(),
    adAccountId: uuid()
      .notNull()
      .references(() => adAccount.id, { onDelete: "cascade" }),
    status: syncStatus().notNull().default("queued"),
    trigger: syncTrigger().notNull(),
    attempts: integer().notNull().default(0),
    rangeStart: date().notNull(),
    rangeEnd: date().notNull(),
    rowsUpserted: integer().notNull().default(0),
    error: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.adAccountId, t.createdAt),
    // At most one in-flight sync per account; enforced by the DB, not just app logic.
    uniqueIndex("sync_run_one_active_per_account")
      .on(t.adAccountId)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

export const recommendation = pgTable(
  "recommendation",
  {
    id: uuid().primaryKey().defaultRandom(),
    adAccountId: uuid()
      .notNull()
      .references(() => adAccount.id, { onDelete: "cascade" }),
    entityId: uuid().references(() => adEntity.id, { onDelete: "cascade" }),
    source: recSource().notNull(),
    /** Rule identifier (e.g. "cpa_spike") or AI model id. */
    ruleId: text().notNull(),
    severity: recSeverity().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    /** Numbers backing the recommendation, shown to the user. */
    evidence: jsonb().$type<Record<string, unknown>>(),
    /** Rough estimated impact, e.g. { metric: "cpa", deltaPct: -12 }. */
    estimatedImpact: jsonb().$type<Record<string, unknown>>(),
    status: recStatus().notNull().default("open"),
    /** Dedup key so a rule doesn't re-open the same issue every sync. */
    fingerprint: text().notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex().on(t.adAccountId, t.fingerprint), index().on(t.adAccountId, t.status)],
);
