/**
 * Mock ads provider: deterministic, realistic sample data for demos and development
 * while real Meta/Google API access is pending.
 *
 * - Same inputs always produce the same output (seeded by ids + dates), so syncing a
 *   range twice is idempotent and every user sees the same demo accounts.
 * - Data is anchored to "today" so the built-in problems always sit in the recent window:
 *     • CPA spike           – one ad group's conversion rate halves over the last 7 days
 *     • Creative fatigue    – one ad's frequency climbs while CTR decays (Meta)
 *     • Wasted spend        – one ad group spends but never converts
 *     • Budget-limited win  – one campaign has high ROAS and spends its whole budget
 *     • Tracking anomaly    – second account's conversions drop to 0 for the last 2 days
 */
import type {
  AdsProvider,
  EntityLevel,
  OAuthTokens,
  Platform,
  ProviderAdAccount,
  ProviderDailyMetric,
  ProviderEntity,
} from "./types";

const MICROS = 1_000_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash. */
export function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG → floats in [0, 1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, min: number, max: number) => min + r() * (max - min);

// ---------------------------------------------------------------------------
// Demo account catalog
// ---------------------------------------------------------------------------

interface MockAccountDef extends ProviderAdAccount {
  /** Which anomaly set this account carries. */
  scenario: "primary" | "secondary";
}

const ACCOUNTS: Record<Platform, MockAccountDef[]> = {
  meta: [
    { externalId: "act_1000000001", name: "Acme Outdoor — US", currency: "USD", timezone: "America/New_York", scenario: "primary" },
    { externalId: "act_1000000002", name: "Acme Outdoor — EU", currency: "EUR", timezone: "Europe/Berlin", scenario: "secondary" },
  ],
  google: [
    { externalId: "1234567890", name: "Acme Outdoor — Search", currency: "USD", timezone: "America/New_York", scenario: "primary" },
    { externalId: "1234567891", name: "Acme Outdoor — Shopping", currency: "USD", timezone: "America/New_York", scenario: "secondary" },
  ],
};

const CAMPAIGNS: Record<Platform, { name: string; objective: string }[]> = {
  meta: [
    { name: "Prospecting — Broad", objective: "OUTCOME_SALES" },
    { name: "Retargeting — 30d Visitors", objective: "OUTCOME_SALES" },
    { name: "Lookalike — Purchasers 1%", objective: "OUTCOME_SALES" },
    { name: "Spring Launch — Tents", objective: "OUTCOME_TRAFFIC" },
  ],
  google: [
    { name: "Brand — Exact", objective: "SEARCH" },
    { name: "Non-Brand — Hiking Boots", objective: "SEARCH" },
    { name: "Performance Max — All Products", objective: "PERFORMANCE_MAX" },
    { name: "Competitor Terms", objective: "SEARCH" },
  ],
};

const AD_GROUP_NAMES: Record<Platform, string[]> = {
  meta: ["Interests: Camping", "Interests: Hiking", "Advantage+ Audience"],
  google: ["Core Keywords", "Long-tail Keywords", "DSA Catch-all"],
};

const AD_NAMES: Record<Platform, string[]> = {
  meta: ["Video — Trail Montage", "Carousel — Best Sellers", "Static — 20% Off", "UGC — Customer Review"],
  google: ["RSA — Benefits", "RSA — Free Shipping", "RSA — Seasonal", "RSA — Price-led"],
};

// ---------------------------------------------------------------------------
// Entity tree
// ---------------------------------------------------------------------------

interface AdProfile {
  externalId: string;
  adGroupExternalId: string;
  campaignExternalId: string;
  baseImpressions: number;
  baseCtr: number;
  cpc: number;
  cvr: number;
  aov: number;
  baseFrequency: number;
  /** Day index (days ago) the ad launched; no delivery before it. */
  launchedDaysAgo: number;
  anomaly?: "cpa_spike" | "fatigue" | "no_conversions" | "winner";
  trackingBreak?: boolean;
}

interface AccountTree {
  entities: ProviderEntity[];
  ads: AdProfile[];
}

const treeCache = new Map<string, AccountTree>();

function findAccount(platform: Platform, externalId: string): MockAccountDef {
  const acct = ACCOUNTS[platform].find((a) => a.externalId === externalId);
  if (!acct) throw new Error(`Unknown mock ad account ${externalId}`);
  return acct;
}

export function buildTree(platform: Platform, accountExternalId: string): AccountTree {
  const key = `${platform}:${accountExternalId}`;
  const cached = treeCache.get(key);
  if (cached) return cached;

  const acct = findAccount(platform, accountExternalId);
  const primary = acct.scenario === "primary";
  const r = rng(hash(key));
  const entities: ProviderEntity[] = [];
  const ads: AdProfile[] = [];
  const idBase = hash(key) % 1_000_000;
  const id = (level: string, ...idx: number[]) => `${level}_${idBase}_${idx.join("_")}`;

  CAMPAIGNS[platform].forEach((camp, ci) => {
    const campaignId = id("c", ci);
    const isWinner = primary && ci === 2;
    const campaignAds: AdProfile[] = [];
    const adGroupCount = 2 + Math.floor(r() * 2);

    for (let gi = 0; gi < adGroupCount; gi++) {
      const groupId = id("g", ci, gi);
      const groupAnomaly =
        primary && ci === 0 && gi === 0 ? "cpa_spike" : primary && ci === 3 && gi === 1 ? "no_conversions" : undefined;
      entities.push({
        level: "ad_group",
        externalId: groupId,
        parentExternalId: campaignId,
        name: AD_GROUP_NAMES[platform][gi % AD_GROUP_NAMES[platform].length]!,
        status: "active",
      });

      const adCount = 2 + Math.floor(r() * 3);
      for (let ai = 0; ai < adCount; ai++) {
        const adId = id("a", ci, gi, ai);
        const isFatigued = platform === "meta" && primary && ci === 1 && gi === 0 && ai === 0;
        const profile: AdProfile = {
          externalId: adId,
          adGroupExternalId: groupId,
          campaignExternalId: campaignId,
          baseImpressions: Math.round(between(r, 800, 9000)),
          baseCtr: between(r, platform === "google" ? 0.025 : 0.007, platform === "google" ? 0.07 : 0.022),
          cpc: between(r, platform === "google" ? 0.9 : 0.45, platform === "google" ? 3.2 : 1.6),
          cvr: isWinner ? between(r, 0.06, 0.08) : between(r, 0.015, 0.045),
          aov: between(r, 45, 140),
          baseFrequency: between(r, 1.05, 1.35),
          launchedDaysAgo: isFatigued ? 60 : Math.round(between(r, 45, 200)),
          anomaly: isFatigued ? "fatigue" : groupAnomaly ?? (isWinner ? "winner" : undefined),
          trackingBreak: !primary,
        };
        ads.push(profile);
        campaignAds.push(profile);
        entities.push({
          level: "ad",
          externalId: adId,
          parentExternalId: groupId,
          name: AD_NAMES[platform][(ai + gi) % AD_NAMES[platform].length]!,
          status: "active",
          attributes: { format: AD_NAMES[platform][(ai + gi) % AD_NAMES[platform].length]!.split(" — ")[0] },
        });
      }
    }

    // Budget ≈ typical spend × headroom; the winner is pinned at ~100% of budget.
    const typicalSpend = campaignAds.reduce((s, a) => s + a.baseImpressions * a.baseCtr * a.cpc, 0);
    entities.push({
      level: "campaign",
      externalId: campaignId,
      parentExternalId: null,
      name: camp.name,
      status: "active",
      objective: camp.objective,
      dailyBudgetMicros: Math.round(typicalSpend * (isWinner ? 1.0 : 1.4) * MICROS),
      attributes: { bidStrategy: platform === "google" ? "MAXIMIZE_CONVERSIONS" : "LOWEST_COST" },
    });
  });

  // Campaigns first, then ad groups, then ads (parents before children).
  const order: Record<EntityLevel, number> = { campaign: 0, ad_group: 1, ad: 2 };
  entities.sort((a, b) => order[a.level] - order[b.level]);

  const tree = { entities, ads };
  treeCache.set(key, tree);
  return tree;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function parseDate(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Generate one ad's metrics for one day. `daysAgo` is relative to `today`. */
function adDay(platform: Platform, ad: AdProfile, date: string, daysAgo: number): ProviderDailyMetric | null {
  if (daysAgo > ad.launchedDaysAgo || daysAgo < 0) return null;
  const r = rng(hash(`${ad.externalId}:${date}`));
  const noise = () => between(r, 0.85, 1.15);
  const dow = new Date(parseDate(date)).getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 1.12 : 1;

  let impressions = ad.baseImpressions * weekend * noise();
  let ctr = ad.baseCtr * noise();
  let cvr = ad.cvr * noise();
  let frequency = ad.baseFrequency;

  const age = ad.launchedDaysAgo - daysAgo; // days since launch
  if (ad.anomaly === "fatigue") {
    // Frequency climbs ~0.08/day; CTR decays as the audience saturates.
    frequency = ad.baseFrequency + age * 0.08;
    ctr *= Math.max(0.35, 1 - age * 0.012);
  }
  if (ad.anomaly === "cpa_spike" && daysAgo < 7) cvr *= 0.45;
  if (ad.anomaly === "no_conversions") cvr = 0;
  if (ad.anomaly === "winner") impressions *= 1.0; // capped by budget, so no growth

  const clicks = Math.round(impressions * ctr);
  const spend = clicks * ad.cpc * between(r, 0.92, 1.08);
  let conversions = clicks * cvr;
  if (ad.trackingBreak && daysAgo < 2) conversions = 0;
  conversions = Math.round(conversions * 10) / 10;
  const value = conversions * ad.aov * between(r, 0.9, 1.1);

  const metric: ProviderDailyMetric = {
    level: "ad",
    externalId: ad.externalId,
    date,
    impressions: Math.round(impressions),
    clicks,
    spendMicros: Math.round(spend * MICROS),
    conversions,
    conversionValueMicros: Math.round(value * MICROS),
  };
  if (platform === "meta") {
    metric.reach = Math.round(impressions / frequency);
    metric.videoViews = Math.round(impressions * between(r, 0.15, 0.35));
  }
  return metric;
}

function addInto(target: ProviderDailyMetric, m: ProviderDailyMetric) {
  target.impressions += m.impressions;
  target.clicks += m.clicks;
  target.spendMicros += m.spendMicros;
  target.conversions = Math.round((target.conversions + m.conversions) * 10) / 10;
  target.conversionValueMicros += m.conversionValueMicros;
  // Reach isn't strictly additive across ads; summing is an upper bound, acceptable for mock data.
  if (m.reach !== undefined) target.reach = (target.reach ?? 0) + m.reach;
  if (m.videoViews !== undefined) target.videoViews = (target.videoViews ?? 0) + m.videoViews;
}

export function generateMetrics(
  platform: Platform,
  accountExternalId: string,
  range: { start: string; end: string },
  today: Date = new Date(),
): ProviderDailyMetric[] {
  const { ads } = buildTree(platform, accountExternalId);
  const todayMs = parseDate(formatDate(today.getTime()));
  const out: ProviderDailyMetric[] = [];

  for (let t = parseDate(range.start); t <= parseDate(range.end); t += DAY_MS) {
    const date = formatDate(t);
    const daysAgo = Math.round((todayMs - t) / DAY_MS);
    const groups = new Map<string, ProviderDailyMetric>();
    const campaigns = new Map<string, ProviderDailyMetric>();

    for (const ad of ads) {
      const m = adDay(platform, ad, date, daysAgo);
      if (!m) continue;
      out.push(m);
      for (const [map, level, key] of [
        [groups, "ad_group", ad.adGroupExternalId],
        [campaigns, "campaign", ad.campaignExternalId],
      ] as const) {
        let agg = map.get(key);
        if (!agg) {
          agg = { level, externalId: key, date, impressions: 0, clicks: 0, spendMicros: 0, conversions: 0, conversionValueMicros: 0 };
          map.set(key, agg);
        }
        addInto(agg, m);
      }
    }
    out.push(...groups.values(), ...campaigns.values());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function createMockProvider(platform: Platform): AdsProvider {
  return {
    platform,
    isMock: true,
    // No external consent screen: send the user straight back to our callback.
    getAuthorizationUrl({ state, redirectUri }) {
      const url = new URL(redirectUri);
      url.searchParams.set("code", `mock_code_${platform}`);
      url.searchParams.set("state", state);
      return url.toString();
    },
    async exchangeCode({ code }): Promise<OAuthTokens> {
      if (!code.startsWith("mock_code_")) throw new Error("Invalid mock authorization code");
      return {
        accessToken: `mock_access_${platform}_${crypto.randomUUID()}`,
        refreshToken: platform === "google" ? `mock_refresh_${crypto.randomUUID()}` : undefined,
        expiresAt: new Date(Date.now() + (platform === "meta" ? 60 : 1 / 24) * DAY_MS),
        scopes: platform === "meta" ? ["ads_read"] : ["https://www.googleapis.com/auth/adwords"],
        externalUserId: `mock_${platform}_user`,
      };
    },
    async listAdAccounts() {
      return ACCOUNTS[platform].map(({ scenario: _s, ...a }) => a);
    },
    async listEntities(_token, accountExternalId) {
      return buildTree(platform, accountExternalId).entities;
    },
    async getDailyMetrics(_token, accountExternalId, range) {
      return generateMetrics(platform, accountExternalId, range);
    },
  };
}
