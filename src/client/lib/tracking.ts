/**
 * Lightweight funnel tracking for the public site:
 * - first-touch attribution (UTM params, referrer, landing path), kept for the visit and 30 days after
 * - anonymous funnel events to our own Worker (no cookies, no personal data)
 * - the Meta Pixel, only when a pixel id is configured
 */
import { loadSiteConfig } from "./site";

const ATTR_KEY = "astuteads-attribution";
const SESSION_KEY = "astuteads-session";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export type Attribution = Partial<Record<(typeof UTM_KEYS)[number] | "referrer" | "landing_path", string>>;

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Call once on load. Keeps the first touch unless the new visit carries UTM params (a new ad click). */
export function captureAttribution() {
  const params = new URLSearchParams(window.location.search);
  const utm: Attribution = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) utm[k] = v.slice(0, 200);
  }
  const existing = getAttribution();
  if (Object.keys(utm).length === 0 && existing.landing_path) return;
  const referrer = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : undefined;
  const value: Attribution & { at: number } = {
    ...utm,
    ...(referrer ? { referrer: referrer.slice(0, 500) } : {}),
    landing_path: window.location.pathname,
    at: Date.now(),
  };
  safeSet(window.localStorage, ATTR_KEY, JSON.stringify(value));
}

export function getAttribution(): Attribution {
  const raw = safeGet(window.localStorage, ATTR_KEY);
  if (!raw) return {};
  try {
    const { at, ...rest } = JSON.parse(raw) as Attribution & { at?: number };
    if (at && Date.now() - at > 30 * 86_400_000) return {};
    return rest;
  } catch {
    return {};
  }
}

function sessionId(): string {
  let id = safeGet(window.sessionStorage, SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    safeSet(window.sessionStorage, SESSION_KEY, id);
  }
  return id;
}

export type FunnelEvent = "landing_view" | "demo_start" | "demo_ai_run" | "waitlist_view";

/** Record a funnel event at most once per browser session. */
export function trackOnce(name: FunnelEvent) {
  const key = `astuteads-tracked-${name}`;
  if (safeGet(window.sessionStorage, key)) return;
  safeSet(window.sessionStorage, key, "1");
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, sessionId: sessionId(), attribution: getAttribution() }),
    keepalive: true,
  }).catch(() => {});
  if (name === "demo_start") pixel("track", "ViewContent", { content_name: "demo" });
}

// --- Meta Pixel -------------------------------------------------------------

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded: boolean; version: string; push: unknown };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let pixelStarted = false;

/** Load the Meta Pixel (standard snippet) if configured, and record a PageView. */
export async function initPixel() {
  if (pixelStarted) return;
  pixelStarted = true;
  const { metaPixelId } = await loadSiteConfig();
  if (!metaPixelId || window.fbq) return;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = window._fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  fbq("init", metaPixelId);
  fbq("track", "PageView");
}

export function pixel(...args: unknown[]) {
  window.fbq?.(...args);
}
