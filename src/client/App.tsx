import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useSession } from "./lib/auth-client";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  if (isPending) return <div className="center muted">Loading…</div>;
  if (!data) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { data, isPending } = useSession();
  if (isPending) return <div className="center muted">Loading…</div>;
  if (data) return <Navigate to="/" replace />;
  return <>{children}</>;
}
