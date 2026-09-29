/** One line of the registry self-test: what was checked, whether it passed, and why. */
export interface RegistryCheck {
	detail: string;
	label: string;
	ok: boolean;
}

/**
 * Reads the answer `https://<host>/v2/` gave: a 401 is the healthy one (the
 * registry is reachable and demands a token), a 200 means it let an anonymous
 * caller in, and anything else means Traefik isn't routing the host to it.
 */
export function publicProbeCheck(host: string, status: number): RegistryCheck {
	const label = `https://${host}`;
	if (status === 401) {
		return {
			detail: "Reachable with a valid certificate, and it asks for a token.",
			label,
			ok: true,
		};
	}
	if (status === 200) {
		return {
			detail:
				"Reachable, but it answered an anonymous request: authentication isn't enforced.",
			label,
			ok: false,
		};
	}
	return {
		detail: `Answered ${status} instead of the registry's 401: Traefik isn't routing ${host} to the registry. Check the host's DNS points at this server.`,
		label,
		ok: false,
	};
}

/**
 * The failed check for a certificate that doesn't verify, naming the one that
 * was actually served when it could be read, since Traefik's own default
 * certificate means no router with TLS matches the host.
 */
export function certificateCheck(
	host: string,
	error: string,
	servedSubject: string | null,
): RegistryCheck {
	const served = servedSubject
		? servedSubject.includes("TRAEFIK DEFAULT CERT")
			? " Traefik served its default certificate, so no HTTPS router matches this host yet; saving the host again recreates the registry's router."
			: ` The certificate served is for ${servedSubject}.`
		: "";
	return {
		detail: `The certificate doesn't verify (${error}).${served}`,
		label: `https://${host}`,
		ok: false,
	};
}
