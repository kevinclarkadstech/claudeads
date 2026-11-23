import { createAuthClient } from "better-auth/react";

// Same origin as the Worker, so baseURL only needs the path.
export const authClient = createAuthClient({ basePath: "/api/auth" });
export const { useSession, signIn, signUp, signOut } = authClient;
