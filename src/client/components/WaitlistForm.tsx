import { useCallback, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useSiteConfig } from "../lib/site";
import { getAttribution, pixel } from "../lib/tracking";
import { Turnstile } from "./Turnstile";

const ROLES = [
  ["business_owner", "Business owner"],
  ["in_house_marketer", "In-house marketer"],
  ["agency", "Agency"],
  ["freelancer", "Freelancer / consultant"],
  ["other", "Other"],
] as const;

const SPEND = [
  ["under_1k", "Under $1k"],
  ["1k_5k", "$1k–$5k"],
  ["5k_25k", "$5k–$25k"],
  ["25k_100k", "$25k–$100k"],
  ["100k_plus", "$100k+"],
] as const;

const triedDemo = () => {
  try {
    return window.sessionStorage.getItem("astuteads-tracked-demo_start") === "1";
  } catch {
    return false;
  }
};

export function WaitlistForm() {
  const config = useSiteConfig();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [spend, setSpend] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [state, setState] = useState<"idle" | "sending" | "done" | "already">("idle");
  const [error, setError] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setToken(t), []);

  const needsToken = !!config?.turnstileSiteKey;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsToken && !token) {
      setError("Please wait a moment for the security check to finish.");
      return;
    }
    setState("sending");
    try {
      const eventId = crypto.randomUUID();
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, monthlySpend: spend, platforms, turnstileToken: token, attribution: getAttribution(), triedDemo: triedDemo(), eventId }),
      });
      const data = (await res.json().catch(() => ({}))) as { alreadyOnList?: boolean; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Something went wrong. Please try again.");
      if (!data.alreadyOnList) pixel("track", "Lead", { content_name: "waitlist" }, { eventID: eventId });
      setState(data.alreadyOnList ? "already" : "done");
    } catch (err) {
      setError((err as Error).message);
      setState("idle");
      setResetKey((k) => k + 1); // Turnstile tokens are single-use
    }
  }

  if (state === "done" || state === "already") {
    return (
      <div className="card waitlist-done" role="status">
        <h3>{state === "done" ? "You're on the list 🎉" : "You're already on the list"}</h3>
        <p className="muted">
          We'll email <strong>{email}</strong> when early access opens. In the meantime, try the demo and see what AstuteAds finds.
        </p>
        <Link className="button" to="/demo">Open the demo</Link>
      </div>
    );
  }

  const toggle = (p: string) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <form className="card waitlist-form" onSubmit={submit}>
      <label>
        Work email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      </label>
      <div className="form-row">
        <label>
          I'm a…
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Select (optional)</option>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          Monthly ad spend
          <select value={spend} onChange={(e) => setSpend(e.target.value)}>
            <option value="">Select (optional)</option>
            {SPEND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="checks">
        <legend>I advertise on</legend>
        {[["meta", "Meta (Facebook & Instagram)"], ["google", "Google Ads"], ["other", "Other"]].map(([v, l]) => (
          <label key={v} className="check">
            <input type="checkbox" checked={platforms.includes(v!)} onChange={() => toggle(v!)} />
            <span>{l}</span>
          </label>
        ))}
      </fieldset>
      {needsToken && <Turnstile siteKey={config!.turnstileSiteKey!} onToken={onToken} resetKey={resetKey} />}
      {error && <p className="error small" role="alert">{error}</p>}
      <button type="submit" disabled={state === "sending" || !config}>
        {state === "sending" ? "Joining…" : "Get early access"}
      </button>
      <p className="muted small">
        Free during early access. No spam; one email when your spot opens. See our <Link to="/privacy">privacy policy</Link>.
      </p>
    </form>
  );
}
