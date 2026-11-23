import { useEffect, useMemo } from "react";
import { Link, Outlet } from "react-router";
import { ApiProvider } from "../lib/api-context";
import { createDemoApi, resetDemo } from "./demo-api";
import { trackOnce } from "../lib/tracking";

export function DemoLayout() {
  const api = useMemo(() => createDemoApi(), []);
  useEffect(() => trackOnce("demo_start"), []);

  return (
    <ApiProvider api={api} paths={{ home: "/demo", account: (id) => `/demo/accounts/${id}` }}>
      <div className="demo-bar" role="note">
        <span>
          <strong>Live demo</strong> with sample data. Nothing here is a real ad account.
        </span>
        <span className="demo-actions">
          <button
            className="link small"
            onClick={() => {
              resetDemo();
              window.location.assign("/demo");
            }}
          >
            Reset demo
          </button>
          <Link to="/#waitlist" className="button small">Get early access</Link>
        </span>
      </div>
      <Outlet />
    </ApiProvider>
  );
}
