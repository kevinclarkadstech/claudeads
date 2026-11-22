import type { Totals } from "./api";

export function money(micros: number, currency: string, compact = false): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : micros / 1e6 >= 1000 ? 0 : 2,
  }).format(micros / 1e6);
}

export function num(n: number, compact = false): string {
  return new Intl.NumberFormat(undefined, {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: n < 100 ? 1 : 0,
  }).format(n);
}

export function pct(ratio: number, digits = 2): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Derived metrics; null when the denominator is zero. */
export function derive(t: Totals) {
  return {
    ctr: t.impressions ? t.clicks / t.impressions : null,
    cpcMicros: t.clicks ? t.spendMicros / t.clicks : null,
    cpaMicros: t.conversions ? t.spendMicros / t.conversions : null,
    roas: t.spendMicros ? t.conversionValueMicros / t.spendMicros : null,
    frequency: t.reach ? t.impressions / t.reach : null,
  };
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
