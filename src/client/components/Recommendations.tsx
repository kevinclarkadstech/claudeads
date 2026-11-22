import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Recommendation, type RecStatus, type Severity } from "../lib/api";
import { moneyShort, timeAgo } from "../lib/format";

const TABS: { status: RecStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "accepted", label: "Done" },
  { status: "dismissed", label: "Dismissed" },
  { status: "resolved", label: "Resolved" },
];

const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Opportunity" };

const EMPTY_TEXT: Record<RecStatus, string> = {
  open: "No open recommendations. Nice work — we'll check again after the next sync.",
  accepted: "Recommendations you mark as done appear here.",
  dismissed: "Dismissed recommendations stay hidden for 14 days, then reappear if the issue persists.",
  resolved: "Issues that cleared up on their own (or after your changes) appear here.",
};

/** Severity is never color-only: each badge carries an icon and a text label. */
function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "critical")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <rect x="7.1" y="3.6" width="1.8" height="5.6" rx="0.9" fill="var(--surface)" />
        <circle cx="8" cy="11.6" r="1" fill="var(--surface)" />
      </svg>
    );
  if (severity === "warning")
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <path d="M8 1.5 15 14H1z" fill="currentColor" strokeLinejoin="round" />
        <rect x="7.2" y="5.6" width="1.6" height="4.4" rx="0.8" fill="var(--surface)" />
        <circle cx="8" cy="11.8" r="0.9" fill="var(--surface)" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d="M2 11.5 6 7.5l3 3L14 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 5h4v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImpactChip({ rec }: { rec: Recommendation }) {
  const i = rec.estimatedImpact;
  if (!i) return null;
  const per = i.period === "7d" ? "/wk" : "";
  if (i.direction === "save" && i.amountMicros && i.amountMicros > 0)
    return <span className="chip">Save ~{moneyShort(i.amountMicros, rec.currency)}{per}</span>;
  if (i.direction === "increase" && i.conversions)
    return <span className="chip">+{i.conversions} conversions{per}</span>;
  return null;
}

export function Recommendations({ adAccountId, refreshKey }: { adAccountId?: string; refreshKey?: unknown }) {
  const [status, setStatus] = useState<RecStatus>("open");
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [counts, setCounts] = useState<Record<RecStatus, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await api.recommendations(status, adAccountId);
      setItems(data.recommendations);
      setCounts(data.counts);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status, adAccountId]);

  useEffect(() => void load(), [load, refreshKey]);

  async function act(rec: Recommendation, next: Exclude<RecStatus, "resolved">) {
    // Optimistic: drop it from this tab and adjust counts.
    setItems((prev) => prev?.filter((r) => r.id !== rec.id) ?? null);
    setCounts((prev) => (prev ? { ...prev, [rec.status]: prev[rec.status] - 1, [next]: prev[next] + 1 } : prev));
    try {
      await api.setRecommendationStatus(rec.id, next);
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  return (
    <section className="recs" aria-labelledby="recs-title">
      <div className="recs-head">
        <h3 id="recs-title">Recommendations</h3>
        <div className="filters tight" role="tablist" aria-label="Recommendation status">
          {TABS.map((t) => (
            <button
              key={t.status}
              role="tab"
              aria-selected={status === t.status}
              className={`seg ${status === t.status ? "on" : ""}`}
              onClick={() => setStatus(t.status)}
            >
              {t.label}
              {counts && counts[t.status] > 0 && <span className="count">{counts[t.status]}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error small">{error}</p>}
      {!items ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card empty small">{EMPTY_TEXT[status]}</div>
      ) : (
        <ul className="rec-list">
          {items.map((r) => (
            <li key={r.id} className={`card rec sev-${r.severity}`}>
              <div className="rec-top">
                <span className={`sev sev-${r.severity}`}>
                  <SeverityIcon severity={r.severity} />
                  {SEVERITY_LABEL[r.severity]}
                </span>
                <ImpactChip rec={r} />
                <span className="muted small rec-meta">
                  {!adAccountId && (
                    <>
                      <Link to={`/accounts/${r.adAccountId}`}>{r.accountName}</Link> ·{" "}
                    </>
                  )}
                  {timeAgo(r.updatedAt)}
                </span>
              </div>
              <h4>{r.title}</h4>
              <p className={`rec-body ${expanded.has(r.id) ? "open" : ""}`}>{r.body}</p>
              <div className="row">
                <button className="link small" onClick={() => toggle(r.id)} aria-expanded={expanded.has(r.id)}>
                  {expanded.has(r.id) ? "Show less" : "Show more"}
                </button>
                <span className="spacer" />
                {r.status === "open" ? (
                  <>
                    <button className="link small" onClick={() => act(r, "dismissed")}>Dismiss</button>
                    <button className="secondary small" onClick={() => act(r, "accepted")}>Mark as done</button>
                  </>
                ) : r.status !== "resolved" ? (
                  <button className="link small" onClick={() => act(r, "open")}>Reopen</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
