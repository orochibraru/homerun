const BARE_HOSTNAME_RE =
	/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export interface NormalizedBaseDomain {
	domain: string;
	port: string | null;
}

export function normalizeBaseDomain(raw: string): NormalizedBaseDomain | null {
	let candidate = raw.trim();
	if (candidate.includes("://")) {
		try {
			candidate = new URL(candidate).host;
		} catch {
			return null;
		}
	} else {
		candidate = candidate.split("/")[0] ?? candidate;
	}

	const [domain, port, ...rest] = candidate.split(":");
	if (rest.length > 0 || !domain) {
		return null;
	}
	if (port !== undefined && !/^\d{1,5}$/.test(port)) {
		return null;
	}
	return BARE_HOSTNAME_RE.test(domain) ? { domain, port: port ?? null } : null;
}
