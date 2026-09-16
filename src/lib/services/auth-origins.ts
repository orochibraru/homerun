function originOf(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

/**
 * The origins better-auth should trust for this instance: the env-configured
 * origin and the auth origin themselves, plus both `http://` and `https://`
 * variants of the auth origin's host and the base domain (skipping
 * `localhost`, which is trusted implicitly). Used to build better-auth's
 * `trustedOrigins` list.
 */
export function trustedOriginsFor(params: {
	authOrigin: string | null | undefined;
	baseDomain: string;
	envOrigin: string | null | undefined;
}): string[] {
	const origins = new Set<string>();
	for (const value of [params.envOrigin, params.authOrigin]) {
		const origin = originOf(value);
		if (origin) {
			origins.add(origin);
		}
	}
	const authHost = originOf(params.authOrigin)
		? new URL(params.authOrigin as string).host
		: null;
	for (const host of [authHost, params.baseDomain]) {
		if (host && host !== "localhost") {
			origins.add(`https://${host}`);
			origins.add(`http://${host}`);
		}
	}
	return [...origins];
}
