import type { Db } from "./db/client";
import type { Auth, AuthSession } from "./auth";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
    auth: Auth;
    user: AuthSession["user"] | null;
    session: AuthSession["session"] | null;
  };
};

/** For routes mounted behind the auth middleware. */
export type AuthedEnv = {
  Bindings: Env;
  Variables: AppEnv["Variables"] & { user: AuthSession["user"]; session: AuthSession["session"] };
};
