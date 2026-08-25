import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config";

export interface ResolvedToken {
	token: string;
	source: "env" | "generated" | "persisted";
}

/**
 * Resolves the bearer token every request must present : real instance
 * behavior (it reads/writes `config.tokenFile`), not a stateless helper, so
 * it gets a class alongside the config it reads rather than sitting as a
 * loose function.
 */
class AgentTokenManager {
	/**
	 * An explicit AGENT_TOKEN env var always wins (systemd unit, docker run
	 * -e, etc.). With none set, a token is generated once and persisted to
	 * `config.tokenFile` so restarting the agent doesn't invalidate every
	 * already-registered main-app connection : same "generate once, remember
	 * it" shape as this repo's other secrets, just filesystem-backed instead
	 * of DB-backed since this binary has no database of its own.
	 */
	async resolveToken(): Promise<ResolvedToken> {
		if (config.explicitToken) {
			return { source: "env", token: config.explicitToken };
		}

		const file = Bun.file(config.tokenFile);
		if (await file.exists()) {
			const existing = (await file.text()).trim();
			if (existing) {
				return { source: "persisted", token: existing };
			}
		}

		const token =
			crypto.randomUUID().replaceAll("-", "") +
			crypto.randomUUID().replaceAll("-", "");
		await mkdir(dirname(config.tokenFile), { recursive: true });
		// Bun.write's own `mode` option is a no-op as of Bun 1.4.0 (verified : the
		// file lands as 0644 under the default umask despite passing 0o600 here),
		// so the permission has to be set explicitly afterward instead. This
		// matters : the persisted value is a full-access API credential, silently
		// world/group-readable on a shared host would be a real leak.
		await Bun.write(config.tokenFile, token);
		await chmod(config.tokenFile, 0o600);
		return { source: "generated", token };
	}
}

export const TokenManager = new AgentTokenManager();

/** Constant-time-ish compare : avoids the obvious early-exit timing leak of `===` on secrets. Left as a plain pure function (no instance state involved), same "pure transform doesn't need an instance" precedent as the main app's `docker/labels.ts`. */
export function tokensMatch(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
