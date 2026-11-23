import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Create a per-request Drizzle client over Hyperdrive.
 * Hyperdrive does the real pooling, so each request opens a small, short-lived client.
 */
export function createDb(env: Env) {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    // Type fetching costs an extra round-trip on every connection.
    fetch_types: false,
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>["db"];
