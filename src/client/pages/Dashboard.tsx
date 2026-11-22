import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { signOut, useSession } from "../lib/auth-client";

type Me = { id: string; email: string; name: string };

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  return (
    <div className="shell">
      <header>
        <strong>ClaudeAds</strong>
        <span className="muted">{session?.user.email}</span>
        <button
          className="link"
          onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}
        >
          Sign out
        </button>
      </header>
      <main>
        <h2>Welcome{me ? `, ${me.name}` : ""}</h2>
        <section className="grid">
          <div className="card">
            <h3>Meta Ads</h3>
            <p className="muted">Connect your Meta ad accounts. (Milestone 2, mock first.)</p>
            <button disabled>Connect Meta</button>
          </div>
          <div className="card">
            <h3>Google Ads</h3>
            <p className="muted">Connect your Google Ads accounts. (Milestone 6.)</p>
            <button disabled>Connect Google</button>
          </div>
        </section>
      </main>
    </div>
  );
}
