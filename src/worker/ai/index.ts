import { createClaudeAnalyst } from "./claude";
import { createMockAnalyst } from "./mock";
import type { AiAnalyst } from "./types";

/**
 * AI_PROVIDER=anthropic uses Claude (requires the ANTHROPIC_API_KEY secret);
 * anything else uses the mock analyst.
 */
export function getAnalyst(env: Env): AiAnalyst {
  if (env.AI_PROVIDER === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("AI_PROVIDER is 'anthropic' but ANTHROPIC_API_KEY is not set");
    return createClaudeAnalyst(env);
  }
  return createMockAnalyst();
}

export function aiProviderName(env: Env): "anthropic" | "mock" {
  return env.AI_PROVIDER === "anthropic" ? "anthropic" : "mock";
}
