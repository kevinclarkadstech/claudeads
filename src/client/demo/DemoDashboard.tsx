import { Link } from "react-router";
import { Connections } from "../components/Connections";
import { Recommendations } from "../components/Recommendations";

export function DemoDashboard() {
  return (
    <div className="shell">
      <header>
        <Link to="/" className="brand">AstuteAds</Link>
        <span className="muted small">demo@example.com</span>
      </header>
      <main>
        <h2>Your ad accounts</h2>
        <p className="muted">
          This sample business runs four ad accounts. Open one to see its performance, or start with the recommendations below.
        </p>
        <Connections />
        <Recommendations />
        <div className="card demo-cta">
          <div>
            <h3>Want this for your own ads?</h3>
            <p className="muted">Join the early-access waitlist and we'll let you know when you can connect your accounts.</p>
          </div>
          <Link to="/#waitlist" className="button">Get early access</Link>
        </div>
      </main>
    </div>
  );
}
