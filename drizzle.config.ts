import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/worker/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Direct (non-Hyperdrive) connection string, used only for migrations.
    url: process.env.DATABASE_URL ?? "postgres://claudeads:claudeads@localhost:5432/claudeads",
  },
  casing: "snake_case",
});
