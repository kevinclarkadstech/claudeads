export type Platform = "meta" | "google";

export interface AdAccount {
  id: string;
  connectionId: string;
  platform: Platform;
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  isSelected: boolean;
  lastSyncedAt: string | null;
  latestSync: SyncRun | null;
}

export interface SyncRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  trigger: "initial" | "scheduled" | "manual";
  rangeStart: string;
  rangeEnd: string;
  rowsUpserted: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Totals {
  impressions: number;
  clicks: number;
  spendMicros: number;
  conversions: number;
  conversionValueMicros: number;
  reach: number | null;
}

export type Level = "campaign" | "ad_group" | "ad";

export interface MetricsResponse {
  range: { from: string; to: string; days: number; previousFrom: string; previousTo: string };
  currency: string;
  level: Level;
  totals: { current: Totals; previous: Totals };
  daily: (Totals & { date: string })[];
  entities: (Totals & { id: string; name: string; status: string; parentId: string | null; parentName: string | null; dailyBudgetMicros: number | null })[];
}

export type RecStatus = "open" | "accepted" | "dismissed" | "resolved";
export type Severity = "info" | "warning" | "critical";

export interface Recommendation {
  id: string;
  adAccountId: string;
  accountName: string;
  platform: Platform;
  currency: string;
  entityId: string | null;
  entityName: string | null;
  entityLevel: Level | "account" | null;
  source: "rule" | "ai";
  ruleId: string;
  severity: Severity;
  title: string;
  body: string;
  evidence: Record<string, unknown> | null;
  estimatedImpact: {
    note?: string;
    metric?: string;
    direction?: "save" | "increase";
    amountMicros?: number;
    conversions?: number;
    period?: string;
  } | null;
  status: RecStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AiReview {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  provider: "anthropic" | "mock";
  model: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, public body: { error?: string; message?: string; retryAt?: string }) {
    super(body.message ?? body.error ?? `Request failed (${status})`);
  }
}

export interface Connection {
  id: string;
  platform: Platform;
  externalUserId: string;
  status: "active" | "expired" | "revoked" | "error";
  isMock: boolean;
  scopes: string[] | null;
  createdAt: string;
  adAccounts: AdAccount[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))) as ApiError["body"]);
  return res.json() as Promise<T>;
}

export const api = {
  /** True for the in-browser demo (no server; sample data). */
  isDemo: false as boolean,
  connections: () => request<{ mockMode: boolean; connections: Connection[] }>("/api/connections"),
  disconnect: (id: string) => request<{ ok: true }>(`/api/connections/${id}`, { method: "DELETE" }),
  setAccountSelected: (id: string, isSelected: boolean) =>
    request<{ adAccount: AdAccount; syncStarted: boolean }>(`/api/ad-accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isSelected }),
    }),
  adAccount: (id: string) =>
    request<{ adAccount: AdAccount & { nextManualSyncAt: string | null } }>(`/api/ad-accounts/${id}`),
  syncNow: (id: string) => request<{ syncRunId: string }>(`/api/ad-accounts/${id}/sync`, { method: "POST" }),
  metrics: (id: string, days: number, level: Level) =>
    request<MetricsResponse>(`/api/ad-accounts/${id}/metrics?days=${days}&level=${level}`),
  recommendations: (status: RecStatus, adAccountId?: string) =>
    request<{ recommendations: Recommendation[]; counts: Record<RecStatus, number> }>(
      `/api/recommendations?status=${status}${adAccountId ? `&adAccountId=${adAccountId}` : ""}`,
    ),
  setRecommendationStatus: (id: string, status: Exclude<RecStatus, "resolved">) =>
    request<{ recommendation: { id: string; status: RecStatus } }>(`/api/recommendations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  aiReview: (id: string) =>
    request<{ review: AiReview | null; provider: "anthropic" | "mock"; nextAvailableAt: string | null }>(`/api/ad-accounts/${id}/ai-review`),
  runAiReview: (id: string) => request<{ aiReviewId: string }>(`/api/ad-accounts/${id}/ai-review`, { method: "POST" }),
  /** Full-page navigation: the OAuth flow redirects away and back. */
  startConnect: (platform: Platform) => {
    window.location.href = `/api/connections/${platform}/start`;
  },
};
