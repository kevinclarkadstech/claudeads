import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { RequireAuth, RedirectIfAuthed } from "./App";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { AccountPage } from "./pages/Account";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/login", element: <RedirectIfAuthed><LoginPage /></RedirectIfAuthed> },
  { path: "/", element: <RequireAuth><DashboardPage /></RequireAuth> },
  { path: "/accounts/:id", element: <RequireAuth><AccountPage /></RequireAuth> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
