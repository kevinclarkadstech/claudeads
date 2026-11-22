import type { AdsProvider, Platform } from "./types";
import { createMockProvider } from "./mock";

export const PLATFORMS = ["meta", "google"] as const satisfies readonly Platform[];

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * Pick the provider implementation for a platform.
 * Real adapters (Meta Marketing API, Google Ads REST) plug in here once API access is approved.
 */
export function getProvider(env: Env, platform: Platform): AdsProvider {
  if (env.USE_MOCK_PROVIDERS === "true") return createMockProvider(platform);
  throw new Error(`Live ${platform} provider is not implemented yet; set USE_MOCK_PROVIDERS=true`);
}

export type { AdsProvider, Platform } from "./types";
