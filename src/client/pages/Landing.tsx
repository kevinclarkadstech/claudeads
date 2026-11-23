import { useEffect } from "react";
import { Link } from "react-router";
import { WaitlistForm } from "../components/WaitlistForm";
import { trackOnce } from "../lib/tracking";
import { useSiteConfig } from "../lib/site";

const CHECKS = [
  { title: "Wasted spend", text: "Ad sets and ads spending real money with zero conversions." },
  { title: "Cost spikes", text: "Cost per conversion jumping, and whether clicks or the landing page are to blame." },
  { title: "Tired creative", text: "Ads people have seen too often, with click-through rates sliding." },
  { title: "Budget-capped winners", text: "Campaigns with great returns that are held back by their budget." },
  { title: "Weak ads", text: "Ads with click-through rates far below the rest of your account." },
  { title: "Broken tracking", text: "Clicks keep coming but conversions suddenly stop recording." },
];

const FAQ = [
  {
    q: "Is the demo using real data?",
    a: "No. The demo runs on realistic sample accounts so you can see exactly what AstuteAds reports, without connecting anything.",
  },
  {
    q: "Can AstuteAds change my campaigns?",
    a: "No. AstuteAds asks for read-only access. It tells you what to change and why; you stay in control and make changes in Meta or Google yourself.",
  },
  {
    q: "When can I connect my own accounts?",
    a: "We're opening early access in small groups. Join the waitlist and we'll email you when your spot is ready.",
  },
  {
    q: "How much will it cost?",
    a: "Early access is free. We'll share pricing before early access ends, and you won't be charged without choosing a plan.",
  },
  {
    q: "Where does the AI come in?",
    a: "Daily checks catch specific problems. An AI analyst then reviews the whole account, connects the dots (for example, moving budget from a wasteful ad set to a capped winner) and ranks what to do first.",
  },
];

export function LandingPage() {
  const config = useSiteConfig();
  useEffect(() => trackOnce("landing_view"), []);

  return (
    <div className="site">
      <header className="site-nav">
        <Link to="/" className="logo">Astute<span>Ads</span></Link>
        <nav>
          <a href="#how">How it works</a>
          <a href="#faq">FAQ</a>
          <Link to="/demo" className="button secondary small">Try the demo</Link>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-text">
            <p className="eyebrow">For Meta &amp; Google advertisers</p>
            <h1>Find the leaks in your ad budget.</h1>
            <p className="lead">
              AstuteAds checks every campaign, ad set and ad in your Meta and Google Ads accounts each day, and tells you in plain
              English where money is being wasted and what to do about it.
            </p>
            <div className="cta-row">
              <Link to="/demo" className="button">Try the live demo</Link>
              <a href="#waitlist" className="button secondary">Join the waitlist</a>
            </div>
            <p className="muted small">No signup needed for the demo · Read-only access · Free during early access</p>
          </div>

          <div className="hero-preview" aria-label="Example recommendations">
            <div className="card rec sev-critical">
              <div className="rec-top">
                <span className="sev sev-critical">● Critical</span>
                <span className="chip">Save ~$921/wk</span>
              </div>
              <h4>“Interests: Hiking” spent $920.92 with no conversions</h4>
              <p className="rec-body open">
                That's 36.5× your account's typical cost per conversion ($25.23). Pause it or move its budget to better performers.
              </p>
            </div>
            <div className="card rec sev-warning">
              <div className="rec-top">
                <span className="sev sev-warning">▲ Warning</span>
                <span className="badge ai">AI · medium confidence</span>
              </div>
              <h4>Move ~$130/day from “Interests: Hiking” to “Lookalike — Purchasers 1%”</h4>
              <p className="rec-body open">
                The lookalike campaign returns 6.81× and is capped by its $589/day budget. Shift budget in two steps a few days apart.
              </p>
            </div>
            <p className="muted small preview-note">Examples from the demo's sample account.</p>
          </div>
        </section>

        <section id="how" className="section">
          <h2>How it works</h2>
          <ol className="steps">
            <li className="card">
              <span className="step-n">1</span>
              <h3>Connect, read-only</h3>
              <p className="muted">Sign in with Meta or Google. AstuteAds can read performance data; it can't edit or spend.</p>
            </li>
            <li className="card">
              <span className="step-n">2</span>
              <h3>Daily checks</h3>
              <p className="muted">Every day we compare the last week with the month before and flag what changed, down to the individual ad.</p>
            </li>
            <li className="card">
              <span className="step-n">3</span>
              <h3>Clear next steps</h3>
              <p className="muted">Each issue comes with the numbers behind it, what to do, and the estimated impact. An AI analyst ranks what matters most.</p>
            </li>
          </ol>
        </section>

        <section className="section">
          <h2>What it catches</h2>
          <div className="checks-grid">
            {CHECKS.map((c) => (
              <div key={c.title} className="card">
                <h3>{c.title}</h3>
                <p className="muted">{c.text}</p>
              </div>
            ))}
          </div>
          <div className="center-cta">
            <Link to="/demo" className="button">See it on a sample account</Link>
          </div>
        </section>

        <section id="waitlist" className="section waitlist">
          <div>
            <h2>Get early access</h2>
            <p className="muted">
              We're onboarding advertisers in small groups. Tell us a little about your ads and we'll let you know when your
              spot opens.
            </p>
          </div>
          <WaitlistForm />
        </section>

        <section id="faq" className="section">
          <h2>Questions</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q} className="card">
                <summary>{f.q}</summary>
                <p className="muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter contactEmail={config?.contactEmail} />
    </div>
  );
}

export function SiteFooter({ contactEmail }: { contactEmail?: string }) {
  return (
    <footer className="site-footer">
      <span>© {new Date().getFullYear()} AstuteAds</span>
      <Link to="/privacy">Privacy</Link>
      {contactEmail && <a href={`mailto:${contactEmail}`}>{contactEmail}</a>}
      <span className="muted small">Meta and Google Ads are trademarks of their respective owners. AstuteAds is not affiliated with Meta or Google.</span>
    </footer>
  );
}
