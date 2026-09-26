import { type HealthcheckTiming, healthcheckTiming } from "./healthcheck.ts";
import { ROLLOUT_WINDOW } from "./rollout.ts";

export const READINESS_LABEL = "homerun.readiness";

const SECOND_NS = 1_000_000_000;

/**
 * The shell script behind the generated readiness check: passes once a
 * socket in the container's own network namespace listens on `port` on a
 * non-loopback address, read from `/proc/net/tcp` and `/proc/net/tcp6` with
 * nothing but `/bin/sh` builtins, so it works in images without nc, curl,
 * wget or bash.
 */
export function listeningScript(port: number): string {
	const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
	return [
		"for table in /proc/net/tcp /proc/net/tcp6; do",
		'[ -r "$table" ] || continue;',
		"while read -r _ address _ state _; do",
		'case "$address" in',
		"*7F:*|00000000000000000000000001000000:*) ;;",
		`*:${hexPort}) [ "$state" = 0A ] && exit 0;;`,
		"esac;",
		'done < "$table";',
		"done;",
		"exit 1",
	].join(" ");
}

/**
 * The Docker `Healthcheck` spec for the generated readiness check: probed
 * every second while starting, for as long as a rollout waits, then every
 * 30s, unhealthy after 3 misses in a row. The service's interval, timeout
 * and retries overrides apply; its start period doesn't, the rollout window
 * owns that.
 */
export function listeningHealthcheck(
	port: number,
	timing: HealthcheckTiming = {},
) {
	return {
		...healthcheckTiming(
			{ ...timing, startPeriodSeconds: null },
			{
				intervalSeconds: 30,
				retries: 3,
				startPeriodSeconds: ROLLOUT_WINDOW.maxWaitMs / 1000,
				timeoutSeconds: 5,
			},
		),
		StartInterval: SECOND_NS,
		Test: ["CMD-SHELL", listeningScript(port)],
	};
}
