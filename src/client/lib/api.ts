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
  /** Full-page navigation: the OAuth flow redirects away and back. */
  startConnect: (platform: Platform) => {
    window.location.href = `/api/connections/${platform}/start`;
  },
};
