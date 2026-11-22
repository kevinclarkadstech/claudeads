import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "./db/client";
import * as schema from "./db/schema";

/**
 * Better Auth is constructed per request because bindings (Hyperdrive, secrets)
 * are only available on the request's `env`.
 */
export function createAuth(env: Env, db: Db) {
  return betterAuth({
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
    },
    session: {
      // Signed cookie cache avoids a DB lookup on most requests.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Google/Microsoft social login can be added here later via `socialProviders`.
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
