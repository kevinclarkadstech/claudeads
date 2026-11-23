import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// `--mode public` builds the public site (landing page + in-browser demo + waitlist Worker);
// the default mode builds the full app (auth, Postgres, ad-platform sync).
export default defineConfig(({ mode }) => ({
  plugins: [react(), cloudflare({ configPath: mode === "public" ? "wrangler.public.jsonc" : "wrangler.jsonc" })],
}));
