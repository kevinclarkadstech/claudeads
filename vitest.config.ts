import { defineConfig } from "vitest/config";

// Plain unit tests; skips the Cloudflare Vite plugin used for the app build.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
