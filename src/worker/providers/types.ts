/**
 * Platform adapter contract. Meta, Google and the mock provider all implement this,
 * and everything downstream (sync, rules, AI) only sees these normalized shapes.
 * Implementations arrive in milestones 2–3; mock-first while platform approvals are pending.
 */
export type Platform = "meta" | "google";
export type EntityLevel = "campaign" | "ad_group" | "ad";

export interface ProviderAdAccount {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
}

export interface ProviderEntity {
  level: EntityLevel;
  externalId: string;
  parentExternalId: string | null;
  name: string;
  status: "active" | "paused" | "archived" | "removed";
  objective?: string;
  dailyBudgetMicros?: number;
  attributes?: Record<string, unknown>;
}

export interface ProviderDailyMetric {
  level: EntityLevel;
  externalId: string;
  /** YYYY-MM-DD in the ad account's timezone. */
  date: string;
  impressions: number;
  clicks: number;
  spendMicros: number;
  conversions: number;
  conversionValueMicros: number;
  reach?: number;
  videoViews?: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  externalUserId: string;
}

export interface AdsProvider {
  platform: Platform;
  /** URL to send the user to for consent. */
  getAuthorizationUrl(opts: { state: string; redirectUri: string }): string;
  exchangeCode(opts: { code: string; redirectUri: string }): Promise<OAuthTokens>;
  refresh?(refreshToken: string): Promise<OAuthTokens>;
  listAdAccounts(accessToken: string): Promise<ProviderAdAccount[]>;
  listEntities(accessToken: string, accountExternalId: string): Promise<ProviderEntity[]>;
  getDailyMetrics(
    accessToken: string,
    accountExternalId: string,
    range: { start: string; end: string },
  ): Promise<ProviderDailyMetric[]>;
}
