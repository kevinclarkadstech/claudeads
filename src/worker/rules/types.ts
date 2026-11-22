export interface Totals {
  impressions: number;
  clicks: number;
  spendMicros: number;
  conversions: number;
  conversionValueMicros: number;
  /** Null when the platform doesn't report reach (Google). */
  reach: number | null;
}

export type Level = "campaign" | "ad_group" | "ad";

/** One entity's totals over the two comparison windows. */
export interface EntityStats {
  id: string;
  level: Level;
  name: string;
  parentId: string | null;
  parentName: string | null;
  status: string;
  dailyBudgetMicros: number | null;
  /** Last 7 complete days. */
  recent: Totals;
  /** The 28 days before `recent`. */
  baseline: Totals;
}

export interface RuleContext {
  account: { id: string; platform: "meta" | "google"; currency: string };
  windows: { recentStart: string; recentEnd: string; baselineStart: string; baselineEnd: string };
  entities: EntityStats[];
  /** Account totals per day (campaign-level sums), baselineStart..recentEnd, no gaps. */
  accountDaily: (Totals & { date: string })[];
  config: RuleConfig;
}

export type Severity = "info" | "warning" | "critical";

export interface Finding {
  ruleId: string;
  entityId: string | null;
  severity: Severity;
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  estimatedImpact: Record<string, unknown> | null;
}

export type Rule = (ctx: RuleContext) => Finding[];

/**
 * Thresholds. Defaults are deliberately conservative; minimums stop rules firing on noise.
 * Later these become per-account settings (e.g. a target CPA).
 */
export interface RuleConfig {
  cpaSpike: { minIncrease: number; criticalIncrease: number; minBaselineConversions: number; minRecentSpendMicros: number };
  fatigue: { minFrequency: number; minCtrDrop: number; minImpressions: number };
  wastedSpend: { cpaMultiple: number; minSpendMicros: number };
  budgetLimited: { minUtilization: number; minRoasMultiple: number; minConversions: number };
  lowCtr: { maxRatioToMedian: number; minImpressions: number; minPeers: number };
  tracking: { maxConversionRatio: number; minClickRatio: number; minBaselineDailyConversions: number };
}

export const DEFAULT_CONFIG: RuleConfig = {
  cpaSpike: { minIncrease: 0.3, criticalIncrease: 0.75, minBaselineConversions: 10, minRecentSpendMicros: 50e6 },
  fatigue: { minFrequency: 4, minCtrDrop: 0.25, minImpressions: 1000 },
  wastedSpend: { cpaMultiple: 2, minSpendMicros: 25e6 },
  budgetLimited: { minUtilization: 0.9, minRoasMultiple: 1.3, minConversions: 10 },
  lowCtr: { maxRatioToMedian: 0.5, minImpressions: 2000, minPeers: 4 },
  tracking: { maxConversionRatio: 0.1, minClickRatio: 0.5, minBaselineDailyConversions: 5 },
};
