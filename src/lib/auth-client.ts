import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/svelte";

export const authClient = createAuthClient({
	basePath: "/api/v1/auth",
	baseURL: typeof window === "undefined" ? "" : window.location.origin,
	plugins: [passkeyClient(), twoFactorClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
