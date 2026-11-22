import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AiReview } from "../lib/api";
import { timeAgo } from "../lib/format";

const isActive = (r: AiReview | null) => r?.status === "queued" || r?.status === "running";

/** Runs an AI review of the account and shows its overall assessment. Calls onComplete when a review finishes. */
export function AiReviewPanel({ adAccountId, onComplete }: { adAccountId: string; onComplete: () => void }) {
  const [review, setReview] = useState<AiReview | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "mock">("mock");
  const [nextAt, setNextAt] = useState<number>(0);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const wasActive = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await api.aiReview(adAccountId);
      setReview(data.review);
      setProvider(data.provider);
      setNextAt(data.nextAvailableAt ? Date.parse(data.nextAvailableAt) : 0);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [adAccountId]);

  useEffect(() => void load(), [load]);

  // Poll while running; notify the parent once it finishes so recommendations refresh.
  useEffect(() => {
    if (isActive(review)) {
      wasActive.current = true;
      const t = setTimeout(load, 2000);
      return () => clearTimeout(t);
    }
    if (wasActive.current) {
      wasActive.current = false;
      onComplete();
    }
  }, [review, load, onComplete]);

  useEffect(() => {
    if (nextAt <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [nextAt]);

  async function run() {
    setNotice(null);
    try {
      await api.runAiReview(adAccountId);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : (e as Error).message);
    }
    await load();
  }

  if (!loaded) return null;
  const active = isActive(review);
  const wait = Math.max(0, Math.ceil((nextAt - now) / 1000));
  const waitLabel = wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait}s`;

  return (
    <section className="card ai-panel" aria-labelledby="ai-title" aria-busy={active}>
      <div className="ai-head">
        <div>
          <h3 id="ai-title">
            AI analysis <span className="badge ai">AI</span>
            {provider === "mock" && <span className="pill">demo</span>}
          </h3>
          <p className="muted small">
            {provider === "mock"
              ? "Demo analyst: generated from your data without calling a model."
              : "Claude reviews this account's last 7 days and what our rules found, then prioritizes what to do."}
          </p>
        </div>
        <button onClick={run} disabled={active || wait > 0} className={review?.summary ? "secondary" : undefined}>
          {active ? "Analyzing…" : wait > 0 ? `Available in ${waitLabel}` : review?.summary ? "Run again" : "Run AI analysis"}
        </button>
      </div>

      {notice && <p className="small error">{notice}</p>}
      {active && (
        <p className="small"><span className="dot pulse" aria-hidden /> Reviewing campaigns, ad sets and ads… this can take up to a minute.</p>
      )}
      {review?.status === "failed" && !active && <p className="small error">The last analysis failed: {review.error}</p>}
      {review?.summary && !active && (
        <>
          <p className="ai-summary">{review.summary}</p>
          <p className="muted small">
            {timeAgo(review.finishedAt ?? review.createdAt)} · {review.model} · AI suggestions can be wrong; check the numbers before acting.
          </p>
        </>
      )}
    </section>
  );
}
