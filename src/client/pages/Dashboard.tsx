import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { signOut, useSession } from "../lib/auth-client";
import { Connections } from "../components/Connections";
import { Recommendations } from "../components/Recommendations";

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
        <strong>AstuteAds</strong>
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
        <Connections />
        <Recommendations />
      </main>
    </div>
  );
}
