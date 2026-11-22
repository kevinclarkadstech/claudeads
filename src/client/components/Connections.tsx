import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type AdAccount, type Connection, type Platform } from "../lib/api";
import { timeAgo } from "../lib/format";

const PLATFORM_LABEL: Record<Platform, string> = { meta: "Meta Ads", google: "Google Ads" };

export function Connections() {
  const [params, setParams] = useSearchParams();
  const [mockMode, setMockMode] = useState(false);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.connections();
      setMockMode(data.mockMode);
      setConnections(data.connections);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while any account is importing so the status updates without a reload.
  const anySyncing = connections?.some((c) =>
    c.adAccounts.some((a) => a.latestSync?.status === "queued" || a.latestSync?.status === "running"),
  );
  useEffect(() => {
    if (!anySyncing) return;
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, [anySyncing, connections, load]);

  // Flash messages from the OAuth callback redirect.
  const connected = params.get("connected");
  const connectError = params.get("connect_error");
  const dismissFlash = () => setParams({}, { replace: true });

  async function toggle(account: AdAccount) {
    // Optimistic update.
    setConnections((prev) =>
      prev?.map((c) => ({
        ...c,
        adAccounts: c.adAccounts.map((a) => (a.id === account.id ? { ...a, isSelected: !a.isSelected } : a)),
      })) ?? null,
    );
    try {
      const { syncStarted } = await api.setAccountSelected(account.id, !account.isSelected);
      if (syncStarted) void load();
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  }

  async function disconnect(conn: Connection) {
    if (!confirm(`Disconnect ${PLATFORM_LABEL[conn.platform]}? Synced data for its accounts will be deleted.`)) return;
    try {
      await api.disconnect(conn.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!connections) return <p className="muted">{error ?? "Loading connections…"}</p>;

  return (
    <>
      {mockMode && (
        <div className="banner">
          <strong>Demo mode.</strong> Connections use generated sample data, not real ad accounts.
        </div>
      )}
      {connected && (
        <div className="banner success" role="status">
          Connected {PLATFORM_LABEL[connected as Platform] ?? connected}. Choose which accounts to analyze.
          <button className="link" onClick={dismissFlash}>Dismiss</button>
        </div>
      )}
      {(connectError || error) && (
        <div className="banner danger" role="alert">
          {connectError ? `Couldn't connect: ${connectError}` : error}
          <button className="link" onClick={() => { setError(null); dismissFlash(); }}>Dismiss</button>
        </div>
      )}

      <section className="grid">
        {(["meta", "google"] as const).map((platform) => {
          const conn = connections.find((c) => c.platform === platform);
          return (
            <div className="card" key={platform} data-platform={platform}>
              <div className="card-head">
                <h3>{PLATFORM_LABEL[platform]}</h3>
                {conn && <span className={`pill ${conn.status}`}>{conn.isMock ? "demo" : conn.status}</span>}
              </div>

              {!conn ? (
                <>
                  <p className="muted">
                    Connect read-only access to your {PLATFORM_LABEL[platform]} accounts.
                  </p>
                  <button onClick={() => api.startConnect(platform)}>
                    Connect {platform === "meta" ? "Meta" : "Google"}
                    {mockMode ? " (demo)" : ""}
                  </button>
                </>
              ) : (
                <>
                  <p className="muted small">Choose the accounts to sync and analyze:</p>
                  <ul className="accounts">
                    {conn.adAccounts.map((a) => (
                      <li key={a.id} className="account-row">
                        <label className="check">
                          <input type="checkbox" checked={a.isSelected} onChange={() => toggle(a)} />
                          <span>
                            {a.name}
                            <span className="muted small"> · {a.externalId} · {a.currency}</span>
                            {a.isSelected && <AccountSyncLine account={a} />}
                          </span>
                        </label>
                        {a.isSelected && a.lastSyncedAt && (
                          <Link className="small view-link" to={`/accounts/${a.id}`}>View →</Link>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="row">
                    <button className="secondary" onClick={() => api.startConnect(platform)}>Reconnect</button>
                    <button className="link danger" onClick={() => disconnect(conn)}>Disconnect</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}

function AccountSyncLine({ account }: { account: AdAccount }) {
  const s = account.latestSync;
  let text = "Waiting for first sync";
  if (s?.status === "queued" || s?.status === "running") text = s.trigger === "initial" ? "Importing history…" : "Syncing…";
  else if (s?.status === "failed") text = "Last sync failed";
  else if (s?.status === "succeeded") text = `Synced ${timeAgo(s.finishedAt ?? s.createdAt)}`;
  return <span className={`sync-line small ${s?.status === "failed" ? "error" : "muted"}`}>{text}</span>;
}
