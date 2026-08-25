/**
 * Bootstraps the very first (admin) account and mints a real API key, both
 * over plain HTTP against the real running app : no in-process `$lib/*`
 * imports here on purpose. `src/lib/services/auth.ts` (and everything it
 * transitively imports, `$app/environment`/`$app/server`/
 * `better-auth/svelte-kit`) only resolves inside SvelteKit's own Vite
 * build, a bare `bun test` process can't import it directly, confirmed
 * while building this harness. Going over real HTTP for *every* step,
 * including bootstrap, keeps this a genuine black-box integration test
 * rather than one that quietly reaches into the app's internals for the
 * parts that are inconvenient to drive over the wire.
 *
 * Sign-up (`POST /api/v1/auth/sign-up/email`) auto-signs-in (better-auth's
 * default), returning a `set-cookie` session header : that cookie is used
 * for exactly one more call, `POST /api/v1/auth/api-key/create` (session-
 * scoped, mints a real plaintext key), after which every other request in
 * this suite authenticates with `x-api-key` instead, same header
 * `hooks.server.ts`'s authHandler checks for a non-cookie caller.
 */
export interface Bootstrapped {
	apiKey: string;
	userId: string;
}

function firstSessionCookie(res: Response): string {
	const setCookie = res.headers.getSetCookie?.() ?? [];
	const sessionCookie = setCookie.find((c) =>
		c.startsWith("better-auth.session_token="),
	);
	if (!sessionCookie) {
		throw new Error(
			`Sign-up response had no session cookie (got: ${setCookie.join(" | ")})`,
		);
	}
	return sessionCookie.split(";")[0] as string;
}

export async function bootstrapAdmin(origin: string): Promise<Bootstrapped> {
	const signUpRes = await fetch(`${origin}/api/v1/auth/sign-up/email`, {
		body: JSON.stringify({
			email: "admin@integration.test",
			name: "Integration Test Admin",
			password: "integration-test-password-1234",
		}),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	if (!signUpRes.ok) {
		throw new Error(
			`Sign-up failed: ${signUpRes.status} ${await signUpRes.text()}`,
		);
	}
	const signUpBody = (await signUpRes.json()) as { user: { id: string } };
	const cookie = firstSessionCookie(signUpRes);

	// Real, tested-in-review finding while building this suite : apiKey()'s
	// own default rate limit (independent of better-auth's general
	// `rateLimit` option) was just 10 requests per *24 hours* per key
	// before this, which this suite's own polling (waitForStatus) blew
	// through almost immediately, getting 401'd (hooks.server.ts treats a
	// rate-limited verifyApiKey() the same as an actually-invalid key) —
	// not a test-only problem, it would have silently crippled the REST
	// API/CLI for any real session too. Fixed at the source in auth.ts's
	// own apiKey() plugin config (300/min), not worked around here :
	// `rateLimitEnabled` itself is a server-only field the real HTTP
	// endpoint rejects outright for a non-privileged caller, confirmed
	// against @better-auth/api-key's own route source, so this couldn't
	// have been fixed from here even as a workaround.
	const keyRes = await fetch(`${origin}/api/v1/auth/api-key/create`, {
		body: JSON.stringify({ name: "integration-tests" }),
		headers: { "content-type": "application/json", cookie },
		method: "POST",
	});
	if (!keyRes.ok) {
		throw new Error(
			`API key creation failed: ${keyRes.status} ${await keyRes.text()}`,
		);
	}
	const keyBody = (await keyRes.json()) as { key: string };

	return { apiKey: keyBody.key, userId: signUpBody.user.id };
}
