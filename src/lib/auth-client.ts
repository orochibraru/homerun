import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/svelte";

export const authClient = createAuthClient({
	baseURL: typeof window !== "undefined" ? window.location.origin : "",
	basePath: "/api/v1/auth",
	plugins: [passkeyClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
