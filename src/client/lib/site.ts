import { useEffect, useState } from "react";

export interface SiteConfig {
  turnstileSiteKey: string | null;
  metaPixelId: string | null;
  contactEmail: string;
}

const FALLBACK: SiteConfig = { turnstileSiteKey: null, metaPixelId: null, contactEmail: "hello@astuteads.com" };
let pending: Promise<SiteConfig> | null = null;

/** Public runtime config from the Worker (cached for the page's lifetime). */
export function loadSiteConfig(): Promise<SiteConfig> {
  pending ??= fetch("/api/config")
    .then((r) => (r.ok ? (r.json() as Promise<SiteConfig>) : FALLBACK))
    .catch(() => FALLBACK);
  return pending;
}

export function useSiteConfig(): SiteConfig | null {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  useEffect(() => {
    void loadSiteConfig().then(setConfig);
  }, []);
  return config;
}
