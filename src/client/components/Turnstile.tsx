import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

let scriptLoading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  scriptLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load verification"));
    document.head.appendChild(s);
  });
  return scriptLoading;
}

/** Cloudflare Turnstile widget. `resetKey` changes force a fresh token (tokens are single-use). */
export function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (t: string | null) => void; resetKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: (t: string) => onToken(t),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, onToken]);

  useEffect(() => {
    if (resetKey && widgetId.current && window.turnstile) {
      onToken(null);
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey, onToken]);

  return <div ref={ref} className="turnstile" />;
}
