import * as devalue from "devalue";

/** The action's JSON success envelope is plain JSON, but its own `data` field is itself a *devalue*-stringified payload (SvelteKit's form-action response format, confirmed against @sveltejs/kit's own actions.js), not plain JSON : needs a second parse pass. */
async function submitCreateForm(
	origin: string,
	apiKey: string,
	fields: Record<string, string>,
): Promise<string> {
	const body = new URLSearchParams(fields);
	const res = await fetch(`${origin}/remote-hosts/new?/create`, {
		body,
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded",
			// SvelteKit's built-in CSRF check (form actions only, not the REST
			// API) compares this against the request's own host and 403s a
			// same-origin-looking POST that's missing it entirely, which a
			// plain server-side `fetch()` (no browser) never sets on its own :
			// real finding from actually running this suite, not something
			// documented anywhere.
			origin,
			"x-api-key": apiKey,
		},
		method: "POST",
	});
	const envelope = (await res.json()) as { type: string; data?: string };
	if (!res.ok || envelope.type === "failure" || envelope.type === "error") {
		throw new Error(
			`remote-hosts/new?/create failed: ${res.status} ${JSON.stringify(envelope)}`,
		);
	}
	const data = envelope.data
		? (devalue.parse(envelope.data) as { hostId: string })
		: null;
	if (!data?.hostId) {
		throw new Error(
			`remote-hosts/new?/create succeeded but returned no hostId: ${JSON.stringify(envelope)}`,
		);
	}
	return data.hostId;
}

/** Registers a docker-kind remote host pointed at a real second TCP connection to this same daemon (the socat proxy started by startSocatProxy below) : same "genuine second connection, not a second real host" verification trick CLAUDE.md documents for this feature. Returns the created host's id. */
export async function registerDockerRemoteHost(
	origin: string,
	apiKey: string,
	socatPort: number,
): Promise<string> {
	return submitCreateForm(origin, apiKey, {
		dockerHost: `tcp://127.0.0.1:${socatPort}`,
		kind: "docker",
		name: "integration-test-docker-host",
	});
}

/** Registers an agent-kind remote host pointed at the real spawned agent process (see processes.ts). Returns the created host's id. */
export async function registerAgentRemoteHost(
	origin: string,
	apiKey: string,
	agentPort: number,
	agentToken: string,
): Promise<string> {
	return submitCreateForm(origin, apiKey, {
		agentToken,
		agentUrl: `http://127.0.0.1:${agentPort}`,
		kind: "agent",
		name: "integration-test-agent-host",
	});
}
