import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from "react-router";
import { LandingPage } from "./pages/Landing";
import { PrivacyPage } from "./pages/Privacy";
import { captureAttribution, initPixel } from "./lib/tracking";
import "./styles.css";

/** Public build: landing page, in-browser demo and waitlist only (no backend app). */
const PUBLIC_ONLY = import.meta.env.VITE_PUBLIC_ONLY === "true";

const publicRoutes: RouteObject[] = [
  { path: "/", element: <LandingPage /> },
  { path: "/privacy", element: <PrivacyPage /> },
  // The demo (sample-data engine, charts) and the app load on demand so the landing page stays small.
  {
    path: "/demo",
    lazy: async () => ({ Component: (await import("./demo/DemoLayout")).DemoLayout }),
    children: [
      { index: true, lazy: async () => ({ Component: (await import("./demo/DemoDashboard")).DemoDashboard }) },
      { path: "accounts/:id", lazy: async () => ({ Component: (await import("./pages/Account")).AccountPage }) },
    ],
  },
];

const appRoutes: RouteObject[] = [
  {
    path: "/login",
    lazy: async () => {
      const [{ RedirectIfAuthed }, { LoginPage }] = await Promise.all([import("./App"), import("./pages/Login")]);
      return { Component: () => <RedirectIfAuthed><LoginPage /></RedirectIfAuthed> };
    },
  },
  {
    path: "/app",
    lazy: async () => {
      const [{ RequireAuth }, { DashboardPage }] = await Promise.all([import("./App"), import("./pages/Dashboard")]);
      return { Component: () => <RequireAuth><DashboardPage /></RequireAuth> };
    },
  },
  {
    path: "/app/accounts/:id",
    lazy: async () => {
      const [{ RequireAuth }, { AccountPage }] = await Promise.all([import("./App"), import("./pages/Account")]);
      return { Component: () => <RequireAuth><AccountPage /></RequireAuth> };
    },
  },
];

const router = createBrowserRouter(
  PUBLIC_ONLY
    ? [...publicRoutes, { path: "*", element: <Navigate to="/" replace /> }]
    : [...publicRoutes.filter((r) => r.path === "/demo"), ...appRoutes, { path: "*", element: <Navigate to="/app" replace /> }],
);

if (PUBLIC_ONLY) {
  captureAttribution();
  void initPixel();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
