import { describe, expect, it } from "vitest";
import { buildTree, generateMetrics } from "../src/worker/providers/mock";
import type { Platform } from "../src/worker/providers/types";
import { contextFromProviderData, windowsFor } from "../src/worker/rules/context";
import { evaluate } from "../src/worker/rules/rules";
import type { RuleContext } from "../src/worker/rules/types";
import { buildAccountSummary } from "../src/worker/ai/summary";
import { createMockAnalyst, mockReview } from "../src/worker/ai/mock";
import { createClaudeAnalyst } from "../src/worker/ai/claude";
import { AiReviewOutput } from "../src/worker/ai/types";

const TODAY = "2026-11-22";
const fakeUuid = (s: string) => `00000000-0000-4000-8000-${s.replace(/\D/g, "").padStart(12, "0").slice(-12)}`;

function mockContext(platform: Platform, account: string): RuleContext {
  const w = windowsFor(TODAY);
  return contextFromProviderData({
    account: { id: account, platform, currency: "USD" },
    today: TODAY,
    entities: buildTree(platform, account).entities,
    rows: generateMetrics(platform, account, { start: w.baselineStart, end: w.recentEnd }, new Date(`${TODAY}T12:00:00Z`)),
    idOf: fakeUuid, // uuid-like ids, to check they never leak into the AI summary
  });
}

function summaryFor(platform: Platform, account: string) {
  const ctx = mockContext(platform, account);
  return { ctx, ...buildAccountSummary(ctx, evaluate(ctx), { name: "Acme", timezone: "America/New_York" }) };
}

describe("account summary", () => {
  const { ctx, summary, refs } = summaryFor("meta", "act_1000000001");

  it("uses short refs and never leaks internal ids", () => {
    expect(JSON.stringify(summary)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(summary.campaigns[0]!.ref).toBe("C1");
    for (const g of summary.adGroups) expect(g.parentRef).toMatch(/^C\d+$/);
    for (const ref of refs.keys()) expect(ref).toMatch(/^[CGA]\d+$/);
  });

  it("maps rule findings to refs", () => {
    expect(summary.ruleFindings.length).toBeGreaterThan(0);
    for (const f of summary.ruleFindings) if (f.entityRef) expect(refs.has(f.entityRef)).toBe(true);
  });

  it("expresses the baseline as a weekly average", () => {
    const campaigns = ctx.entities.filter((e) => e.level === "campaign");
    const baseline28 = campaigns.reduce((s, c) => s + c.baseline.spendMicros, 0) / 1e6;
    expect(summary.totals.baseline.spend).toBeCloseTo(baseline28 / 4, 0);
    // Weekly baseline should be in the same ballpark as the recent week for this account.
    expect(summary.totals.baseline.spend / summary.totals.recent.spend).toBeGreaterThan(0.7);
    expect(summary.totals.baseline.spend / summary.totals.recent.spend).toBeLessThan(1.3);
  });

  it("orders by spend and caps list sizes", () => {
    const spends = summary.ads.map((a) => a.recent.spend);
    expect(spends).toEqual([...spends].sort((a, b) => b - a));
    expect(summary.ads.length).toBeLessThanOrEqual(30);
    expect(summary.dailyTrend).toHaveLength(14);
  });
});

describe("mock analyst", () => {
  it("combines wasted spend + budget-capped winner into a reallocation", () => {
    const { summary } = summaryFor("meta", "act_1000000001");
    const out = AiReviewOutput.parse(mockReview(summary));
    const realloc = out.recommendations.find((r) => r.relatedRules.includes("wasted_spend") && r.relatedRules.includes("budget_limited_winner"));
    expect(realloc).toBeDefined();
    expect(realloc!.title).toMatch(/^Move ~\$[\d,]+\/day from “.+” to “.+”$/);
    expect(out.recommendations.length).toBeLessThanOrEqual(5);
    expect(out.summary).toMatch(/spent \$/);
  });

  it("puts broken tracking first", () => {
    const { summary } = summaryFor("meta", "act_1000000002");
    const out = mockReview(summary);
    expect(out.recommendations[0]!.category).toBe("tracking");
    expect(out.recommendations[0]!.severity).toBe("critical");
    expect(out.summary).toContain("tracking");
  });

  it("only references refs that exist, and writes no NaN/undefined", async () => {
    for (const [p, a] of [["meta", "act_1000000001"], ["meta", "act_1000000002"], ["google", "1234567890"], ["google", "1234567891"]] as const) {
      const { summary, refs } = summaryFor(p, a);
      const { output } = await createMockAnalyst({ latencyMs: 0 }).analyze(summary);
      for (const r of output.recommendations) {
        if (r.entityRef) expect(refs.has(r.entityRef)).toBe(true);
        expect(`${r.title} ${r.body} ${r.expectedImpact}`).not.toMatch(/NaN|undefined|Infinity|null/);
      }
      expect(output.summary).not.toMatch(/NaN|undefined/);
    }
  });
});

describe("Claude analyst (HTTP mocked)", () => {
  const { summary } = summaryFor("meta", "act_1000000001");
  const goodOutput = mockReview(summary);

  function fakeFetch(reply: Record<string, unknown>, captured: { url?: string; body?: any; headers?: Headers }) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      captured.url = String(url);
      captured.body = JSON.parse(String(init?.body));
      captured.headers = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(goodOutput) }],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 3000, output_tokens: 900, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
          ...reply,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
  }

  it("sends the expected request and parses structured output", async () => {
    const cap: { url?: string; body?: any; headers?: Headers } = {};
    const analyst = createClaudeAnalyst(
      { ANTHROPIC_API_KEY: "test-key", AI_GATEWAY_URL: "https://gateway.example/v1/acct/gw/anthropic", AI_MODEL: "claude-opus-5-5" },
      { fetch: fakeFetch({}, cap) },
    );
    const result = await analyst.analyze(summary);

    expect(cap.url).toContain("https://gateway.example/v1/acct/gw/anthropic/v1/messages");
    expect(cap.body.model).toBe("claude-opus-5-5");
    expect(cap.body.output_config.effort).toBe("high");
    expect(cap.body.output_config.format.type).toBe("json_schema");
    expect(cap.body.fallbacks).toBe("default");
    expect(cap.body.thinking).toBeUndefined();
    expect(cap.headers!.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(cap.body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(cap.body.messages[0].content).toContain("<account_summary>");

    expect(result.output.recommendations.length).toBe(goodOutput.recommendations.length);
    expect(result.inputTokens).toBe(3500);
    expect(result.outputTokens).toBe(900);
  });

  it("surfaces refusals and truncation as errors", async () => {
    const env = { ANTHROPIC_API_KEY: "k", AI_GATEWAY_URL: "", AI_MODEL: "" };
    await expect(
      createClaudeAnalyst(env, { fetch: fakeFetch({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "x" }, content: [] }, {}) }).analyze(summary),
    ).rejects.toThrow(/declined.*cyber/);
    await expect(createClaudeAnalyst(env, { fetch: fakeFetch({ stop_reason: "max_tokens" }, {}) }).analyze(summary)).rejects.toThrow(/cut off/);
  });
});
