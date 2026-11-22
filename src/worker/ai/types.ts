import { z } from "zod";

/**
 * What the AI must return. Used for Claude's structured output (so the API guarantees the
 * shape) and to validate the mock, so both providers produce identical data.
 */
export const AiReviewOutput = z.object({
  summary: z
    .string()
    .describe("2-4 sentence overall assessment of the account's last 7 days, most important point first."),
  recommendations: z
    .array(
      z.object({
        title: z.string().describe("Short imperative headline, under 80 characters."),
        body: z
          .string()
          .describe("What to do, why, and the numbers from the data that support it. 2-5 sentences, plain English."),
        severity: z.enum(["info", "warning", "critical"]),
        category: z.enum(["budget", "bidding", "creative", "targeting", "tracking", "structure", "other"]),
        entityRef: z
          .string()
          .nullable()
          .describe('The main entity this is about, as its ref from the input (e.g. "C2", "G5", "A12"), or null for account-wide.'),
        expectedImpact: z.string().describe('Short, honest estimate, e.g. "~$900/week less wasted spend". Say "unclear" if unknown.'),
        confidence: z.enum(["low", "medium", "high"]),
        relatedRules: z.array(z.string()).describe("ruleIds from ruleFindings this builds on; empty if none."),
      }),
    )
    .describe("At most 5, highest priority first."),
});
export type AiReviewOutput = z.infer<typeof AiReviewOutput>;

export interface AiAnalysis {
  output: AiReviewOutput;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Implemented by the Claude analyst and the mock. */
export interface AiAnalyst {
  provider: "anthropic" | "mock";
  analyze(summary: AccountSummary): Promise<AiAnalysis>;
}

// ---------------------------------------------------------------------------
// Input: a compact, model-friendly view of the account. Money in currency units.
// ---------------------------------------------------------------------------

export interface WindowStats {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number | null;
  cpc: number | null;
  conversionRate: number | null;
  cpa: number | null;
  roas: number | null;
  frequency: number | null;
}

export interface SummaryEntity {
  ref: string;
  name: string;
  parentRef: string | null;
  status: string;
  dailyBudget?: number | null;
  recent: WindowStats;
  baseline: WindowStats;
}

export interface AccountSummary {
  account: { name: string; platform: "meta" | "google"; currency: string; timezone: string };
  windows: { recent: string; baseline: string };
  totals: { recent: WindowStats; baseline: WindowStats };
  campaigns: SummaryEntity[];
  adGroups: SummaryEntity[];
  ads: SummaryEntity[];
  /** Entities omitted because of the size caps. */
  omitted: { campaigns: number; adGroups: number; ads: number };
  dailyTrend: { date: string; spend: number; conversions: number; clicks: number }[];
  ruleFindings: { ruleId: string; severity: string; entityRef: string | null; title: string }[];
}
