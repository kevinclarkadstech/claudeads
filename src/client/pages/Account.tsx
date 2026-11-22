import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, type AdAccount, type Level, type MetricsResponse, type Totals } from "../lib/api";
import { derive, money, num, pct, shortDate, timeAgo } from "../lib/format";
import { LineChart } from "../components/LineChart";
import { Recommendations } from "../components/Recommendations";

type Account = AdAccount & { nextManualSyncAt: string | null };

const RANGES = [7, 14, 30, 60] as const;
const LEVEL_LABEL: Record<"meta" | "google", Record<Level, string>> = {
  meta: { campaign: "Campaigns", ad_group: "Ad sets", ad: "Ads" },
  google: { campaign: "Campaigns", ad_group: "Ad groups", ad: "Ads" },
};

const isActive = (a: Account | null) => a?.latestSync?.status === "queued" || a?.latestSync?.status === "running";

export function AccountPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [days, setDays] = useState<number>(30);
  const [level, setLevel] = useState<Level>("campaign");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const wasActive = useRef(false);
  const [syncGeneration, setSyncGeneration] = useState(0);

  const loadAccount = useCallback(async () => {
    try {
      const { adAccount } = await api.adAccount(id!);
      setAccount(adAccount);
      return adAccount;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "Account not found." : (e as Error).message);
      return null;
    }
  }, [id]);

  const loadMetrics = useCallback(async () => {
    try {
      setMetrics(await api.metrics(id!, days, level));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, days, level]);

  useEffect(() => void loadAccount(), [loadAccount]);
  useEffect(() => void loadMetrics(), [loadMetrics]);

  // While a sync is in flight, poll; when it finishes, refresh the numbers.
  useEffect(() => {
    if (isActive(account)) {
      wasActive.current = true;
      const t = setTimeout(loadAccount, 2000);
      return () => clearTimeout(t);
    }
    if (wasActive.current) {
      wasActive.current = false;
      void loadMetrics();
      setSyncGeneration((g) => g + 1);
    }
  }, [account, loadAccount, loadMetrics]);

  // Tick once a second only while a cooldown countdown is showing.
  const cooldownUntil = account?.nextManualSyncAt ? Date.parse(account.nextManualSyncAt) : 0;
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  async function syncNow() {
    setNotice(null);
    try {
      await api.syncNow(id!);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 429)) setNotice(e.message);
      else setError((e as Error).message);
    }
    await loadAccount();
  }

  if (error) return <Shell><p className="error">{error}</p></Shell>;
  if (!account) return <Shell><p className="muted">Loading…</p></Shell>;

  const sync = account.latestSync;
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const hasData = metrics?.daily.some((d) => d.impressions > 0) ?? false;

  return (
    <Shell>
      <div className="page-head">
        <div>
          <h2>{account.name}</h2>
          <p className="muted small">
            {account.platform === "meta" ? "Meta Ads" : "Google Ads"} · {account.externalId} · {account.currency} · {account.timezone}
          </p>
        </div>
        <div className="sync-box">
          <SyncStatus account={account} />
          {account.isSelected ? (
            <button
              className="secondary"
              onClick={syncNow}
              disabled={isActive(account) || cooldownLeft > 0}
              title={cooldownLeft > 0 ? "Manual syncs are limited to one every 10 minutes" : undefined}
            >
              {isActive(account)
                ? "Syncing…"
                : cooldownLeft > 0
                  ? `Sync again in ${Math.floor(cooldownLeft / 60)}:${String(cooldownLeft % 60).padStart(2, "0")}`
                  : "Sync now"}
            </button>
          ) : (
            <Link to="/" className="small">Select this account to sync it</Link>
          )}
        </div>
      </div>
      {notice && <div className="banner" role="status">{notice}</div>}
      {sync?.status === "failed" && <div className="banner danger" role="alert">Last sync failed: {sync.error}</div>}

      <div className="filters" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button key={r} className={`seg ${days === r ? "on" : ""}`} aria-pressed={days === r} onClick={() => setDays(r)}>
            {r}d
          </button>
        ))}
        {metrics && (
          <span className="muted small">
            {shortDate(metrics.range.from)} – {shortDate(metrics.range.to)} · vs. previous {metrics.range.days} days
          </span>
        )}
      </div>

      {!metrics ? (
        <p className="muted">Loading metrics…</p>
      ) : !hasData ? (
        <div className="card empty">
          {isActive(account) ? "Importing data… this usually takes a few seconds." : "No data for this range yet. Run a sync to import it."}
        </div>
      ) : (
        <>
          <Kpis current={metrics.totals.current} previous={metrics.totals.previous} currency={metrics.currency} />
          <Recommendations adAccountId={account.id} refreshKey={syncGeneration} />
          <div className="charts">
            <LineChart
              title="Spend per day"
              points={metrics.daily.map((d) => ({ date: d.date, value: d.spendMicros }))}
              format={(v) => money(v, metrics.currency)}
              formatAxis={(v) => money(v, metrics.currency, true)}
            />
            <LineChart
              title="Conversions per day"
              points={metrics.daily.map((d) => ({ date: d.date, value: d.conversions }))}
              format={(v) => num(v)}
              formatAxis={(v) => num(v, true)}
            />
          </div>
          <details className="data-table">
            <summary className="small">Show daily data table</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Date</th><th>Spend</th><th>Impr.</th><th>Clicks</th><th>Conv.</th><th>CPA</th><th>ROAS</th></tr>
                </thead>
                <tbody>
                  {metrics.daily.map((d) => {
                    const x = derive(d);
                    return (
                      <tr key={d.date}>
                        <td>{shortDate(d.date)}</td>
                        <td>{money(d.spendMicros, metrics.currency)}</td>
                        <td>{num(d.impressions)}</td>
                        <td>{num(d.clicks)}</td>
                        <td>{num(d.conversions)}</td>
                        <td>{x.cpaMicros === null ? "—" : money(x.cpaMicros, metrics.currency)}</td>
                        <td>{x.roas === null ? "—" : `${x.roas.toFixed(2)}×`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          <div className="filters" role="tablist" aria-label="Breakdown level">
            {(["campaign", "ad_group", "ad"] as const).map((l) => (
              <button key={l} role="tab" aria-selected={level === l} className={`seg ${level === l ? "on" : ""}`} onClick={() => setLevel(l)}>
                {LEVEL_LABEL[account.platform][l]}
              </button>
            ))}
          </div>
          <EntityTable metrics={metrics} />
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header>
        <Link to="/" className="brand">← ClaudeAds</Link>
      </header>
      <main>{children}</main>
    </div>
  );
}

function SyncStatus({ account }: { account: Account }) {
  const s = account.latestSync;
  if (!s) return <span className="muted small">Never synced</span>;
  if (s.status === "queued" || s.status === "running")
    return <span className="small"><span className="dot pulse" aria-hidden /> {s.trigger === "initial" ? "Importing history…" : "Syncing…"}</span>;
  if (s.status === "failed") return <span className="small error">Sync failed</span>;
  return <span className="muted small">Synced {timeAgo(s.finishedAt ?? s.createdAt)}</span>;
}

/** KPI tiles. `goodWhen` says which direction of change is an improvement. */
function Kpis({ current, previous, currency }: { current: Totals; previous: Totals; currency: string }) {
  const c = derive(current);
  const p = derive(previous);
  const hasPrev = previous.impressions > 0;
  const tiles: { label: string; value: string; cur: number | null; prev: number | null; goodWhen: "up" | "down" }[] = [
    { label: "Spend", value: money(current.spendMicros, currency), cur: current.spendMicros, prev: previous.spendMicros, goodWhen: "up" },
    { label: "Conversions", value: num(current.conversions), cur: current.conversions, prev: previous.conversions, goodWhen: "up" },
    { label: "Cost / conversion", value: c.cpaMicros === null ? "—" : money(c.cpaMicros, currency), cur: c.cpaMicros, prev: p.cpaMicros, goodWhen: "down" },
    { label: "ROAS", value: c.roas === null ? "—" : `${c.roas.toFixed(2)}×`, cur: c.roas, prev: p.roas, goodWhen: "up" },
    { label: "CTR", value: c.ctr === null ? "—" : pct(c.ctr), cur: c.ctr, prev: p.ctr, goodWhen: "up" },
  ];
  return (
    <div className="kpis">
      {tiles.map((t) => {
        const delta = hasPrev && t.cur !== null && t.prev ? (t.cur - t.prev) / t.prev : null;
        // Spend going up is neither good nor bad on its own.
        const tone = delta === null || Math.abs(delta) < 0.005 || t.label === "Spend"
          ? "neutral"
          : (delta > 0) === (t.goodWhen === "up") ? "good" : "bad";
        return (
          <div className="card kpi" key={t.label}>
            <span className="muted small">{t.label}</span>
            <strong>{t.value}</strong>
            {delta !== null && (
              <span className={`delta ${tone}`}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {pct(Math.abs(delta), 1)}
                <span className="sr-only">{tone === "good" ? " (improved)" : tone === "bad" ? " (worse)" : ""} vs. previous period</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EntityTable({ metrics }: { metrics: MetricsResponse }) {
  const cur = metrics.currency;
  return (
    <div className="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Status</th><th>Spend</th><th>Impr.</th><th>CTR</th><th>Conv.</th><th>CPA</th><th>ROAS</th>
          </tr>
        </thead>
        <tbody>
          {metrics.entities.map((e) => {
            const d = derive(e);
            return (
              <tr key={e.id}>
                <td className="name">
                  {e.name}
                  {e.parentName && <span className="muted small parent">{e.parentName}</span>}
                </td>
                <td><span className="pill">{e.status}</span></td>
                <td>{money(e.spendMicros, cur)}</td>
                <td>{num(e.impressions)}</td>
                <td>{d.ctr === null ? "—" : pct(d.ctr)}</td>
                <td>{num(e.conversions)}</td>
                <td>{d.cpaMicros === null ? "—" : money(d.cpaMicros, cur)}</td>
                <td>{d.roas === null ? "—" : `${d.roas.toFixed(2)}×`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
