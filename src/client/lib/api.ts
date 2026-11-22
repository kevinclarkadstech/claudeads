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
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  connections: () => request<{ mockMode: boolean; connections: Connection[] }>("/api/connections"),
  disconnect: (id: string) => request<{ ok: true }>(`/api/connections/${id}`, { method: "DELETE" }),
  setAccountSelected: (id: string, isSelected: boolean) =>
    request<{ adAccount: AdAccount }>(`/api/ad-accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isSelected }),
    }),
  /** Full-page navigation: the OAuth flow redirects away and back. */
  startConnect: (platform: Platform) => {
    window.location.href = `/api/connections/${platform}/start`;
  },
};
