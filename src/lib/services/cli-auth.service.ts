import { randomBytes, randomInt } from "node:crypto";
import { Logger } from "$lib/logger";
import { auth } from "./auth.ts";

const logger = new Logger("CliAuth");

/**
 * Backs the CLI's `homerun login` machine-to-machine flow: the CLI starts a
 * request here (no session, it has no browser of its own), a human approves
 * it from an already-authenticated browser tab (any device, not necessarily
 * the CLI's own machine, this is deliberately not a loopback-redirect flow
 * like `gh auth login`'s default), and the CLI polls until that happens.
 *
 * State is in-memory only, not a DB table, same "ephemeral session state
 * doesn't need a row" precedent as terminal.ts's TerminalSession map, this
 * app is single-host/single-process so there's nothing to share across
 * instances, and every entry is ten minutes from expiry anyway. Survives
 * Vite HMR the same way (globalThis-backed), so a dev-server reload mid-flow
 * doesn't orphan a pending request.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 3;

export type CliAuthStatus = "approved" | "denied" | "expired" | "pending";

interface DeviceEntry {
	apiKey?: string;
	createdAt: number;
	expiresAt: number;
	status: CliAuthStatus;
	userCode: string;
}

const globalForCliAuth = globalThis as unknown as {
	__cli_auth_devices?: Map<string, DeviceEntry>;
};

function devices(): Map<string, DeviceEntry> {
	if (!globalForCliAuth.__cli_auth_devices) {
		globalForCliAuth.__cli_auth_devices = new Map();
	}
	return globalForCliAuth.__cli_auth_devices;
}

/** Human-typeable, avoids visually-ambiguous characters (0/O, 1/I). */
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateUserCode(): string {
	const part = () =>
		Array.from({ length: 4 }, () =>
			USER_CODE_ALPHABET.at(randomInt(USER_CODE_ALPHABET.length)),
		).join("");
	return `${part()}-${part()}`;
}

class CliAuthServiceClass {
	/** Drops expired/stale entries; called on every access, the table is tiny so a full sweep is cheap. */
	#prune(): void {
		const now = Date.now();
		for (const [deviceCode, entry] of devices()) {
			if (entry.expiresAt < now && entry.status === "pending") {
				entry.status = "expired";
			}
			// Keep expired/denied/approved entries around until their own TTL
			// so a slow final poll still gets a real answer, only drop them
			// once genuinely stale.
			if (now - entry.createdAt > CODE_TTL_MS * 2) {
				devices().delete(deviceCode);
			}
		}
	}

	startDeviceAuth(): {
		deviceCode: string;
		expiresIn: number;
		interval: number;
		userCode: string;
	} {
		this.#prune();
		const deviceCode = randomBytes(32).toString("hex");
		let userCode = generateUserCode();
		const taken = new Set([...devices().values()].map((e) => e.userCode));
		while (taken.has(userCode)) {
			userCode = generateUserCode();
		}

		const now = Date.now();
		devices().set(deviceCode, {
			createdAt: now,
			expiresAt: now + CODE_TTL_MS,
			status: "pending",
			userCode,
		});

		logger.info("CLI device auth started", { userCode });

		return {
			deviceCode,
			expiresIn: Math.floor(CODE_TTL_MS / 1000),
			interval: POLL_INTERVAL_SECONDS,
			userCode,
		};
	}

	/** Looked up by the approval page from the code the human typed/was linked with. */
	findByUserCode(userCode: string): DeviceEntry | null {
		this.#prune();
		const normalized = userCode.trim().toUpperCase();
		for (const entry of devices().values()) {
			if (entry.userCode === normalized && entry.status === "pending") {
				return entry;
			}
		}
		return null;
	}

	async approve(userCode: string, userId: string): Promise<boolean> {
		this.#prune();
		const normalized = userCode.trim().toUpperCase();
		for (const entry of devices()) {
			const [, value] = entry;
			if (value.userCode !== normalized || value.status !== "pending") {
				continue;
			}
			const created = await auth.api.createApiKey({
				body: {
					name: "CLI login",
					userId,
				},
			});
			value.apiKey = created.key;
			value.status = "approved";
			logger.info("CLI device auth approved", { userCode: normalized, userId });
			return true;
		}
		return false;
	}

	deny(userCode: string): boolean {
		this.#prune();
		const normalized = userCode.trim().toUpperCase();
		for (const entry of devices().values()) {
			if (entry.userCode === normalized && entry.status === "pending") {
				entry.status = "denied";
				logger.info("CLI device auth denied", { userCode: normalized });
				return true;
			}
		}
		return false;
	}

	poll(deviceCode: string): {
		apiKey?: string;
		status: CliAuthStatus | "not_found";
	} {
		this.#prune();
		const entry = devices().get(deviceCode);
		if (!entry) {
			return { status: "not_found" };
		}
		if (entry.status === "approved") {
			return { apiKey: entry.apiKey, status: "approved" };
		}
		return { status: entry.status };
	}
}

export const CliAuthService = new CliAuthServiceClass();
