import { dockerHealthcheck } from "./healthcheck.ts";
import { ROLLOUT_WINDOW } from "./rollout.ts";

export const READINESS_LABEL = "homerun.readiness";

const SECOND_NS = 1_000_000_000;
const MILLISECOND_NS = 1_000_000;

export type ReadinessGap =
	| "image-unknown"
	| "no-shell"
	| "not-routed"
	| "udp-only";

export type ReadinessCheck =
	| { kind: "image-healthcheck" }
	| { kind: "listening"; port: number }
	| { kind: "none"; reason: ReadinessGap }
	| { kind: "service-healthcheck" };

export type ImageReadinessFacts =
	| { hasHealthcheck: false; hasShell: boolean }
	| { hasHealthcheck: true };

export interface ReadinessInput {
	containerPort: number;
	dnsResolvable?: boolean;
	healthcheckCommand?: string | null;
	networkMode?: "bridge" | "host";
	portProtocol?: "tcp" | "udp" | "both";
	remote?: boolean;
}

export type ReadinessWorkload = "container" | "task";

/** Whether an image's `Config.Healthcheck.Test` declares a real healthcheck, rather than none or an explicit `NONE`. */
export function imageDeclaresHealthcheck(
	test: string[] | null | undefined,
): boolean {
	return !!test?.length && test[0] !== "NONE";
}

/** Whether picking a readiness check for this service needs facts about its image (its own HEALTHCHECK, a shell), so the Docker lookups are skipped when they can't change the outcome. */
export function readinessNeedsImage(input: ReadinessInput): boolean {
	return (
		!input.healthcheckCommand?.trim() &&
		isRouted(input) &&
		input.portProtocol !== "udp"
	);
}

/**
 * Picks what holds a new container or swarm task back from Traefik until it
 * is ready. Traefik's docker provider skips a container whose Docker health
 * isn't `healthy` and swarm keeps a task out of `running` until its
 * healthcheck passes, so every gate is a Docker healthcheck: the service's
 * own command, the image's `HEALTHCHECK`, or, with neither, a generated one
 * that waits for the container port to be listening. There's no gate when
 * nothing routes to the workload, when the port is UDP only, or when the
 * image has no `/bin/sh` to run a generated check in.
 */
export function readinessCheck(
	input: ReadinessInput,
	image: ImageReadinessFacts | null | undefined,
): ReadinessCheck {
	if (input.healthcheckCommand?.trim()) {
		return { kind: "service-healthcheck" };
	}
	if (!isRouted(input)) {
		return { kind: "none", reason: "not-routed" };
	}
	if (image?.hasHealthcheck) {
		return { kind: "image-healthcheck" };
	}
	if (input.portProtocol === "udp") {
		return { kind: "none", reason: "udp-only" };
	}
	if (!image) {
		return { kind: "none", reason: "image-unknown" };
	}
	if (!image.hasShell) {
		return { kind: "none", reason: "no-shell" };
	}
	return { kind: "listening", port: input.containerPort };
}

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
 * 30s, unhealthy after 3 misses in a row.
 */
export function listeningHealthcheck(port: number) {
	return {
		Interval: 30 * SECOND_NS,
		Retries: 3,
		StartInterval: SECOND_NS,
		StartPeriod: ROLLOUT_WINDOW.maxWaitMs * MILLISECOND_NS,
		Test: ["CMD-SHELL", listeningScript(port)],
		Timeout: 5 * SECOND_NS,
	};
}

/** The `Healthcheck` to create a container or swarm task with for `check`, or undefined to leave the image's own (or none) in place. */
export function readinessHealthcheck(
	check: ReadinessCheck,
	healthcheckCommand: string | null | undefined,
) {
	if (check.kind === "service-healthcheck") {
		return dockerHealthcheck(healthcheckCommand);
	}
	if (check.kind === "listening") {
		return listeningHealthcheck(check.port);
	}
}

/** Labels marking a workload whose Docker health comes from Homerun's generated check, so the uptime probe doesn't mistake it for the image's own healthcheck. */
export function readinessLabels(check: ReadinessCheck): Record<string, string> {
	return check.kind === "listening" ? { [READINESS_LABEL]: "listening" } : {};
}

/** The deploy log line saying which readiness check holds traffic back from the new container or task, and what that means when there's none. */
export function readinessDescription(
	check: ReadinessCheck,
	workload: ReadinessWorkload,
): string {
	switch (check.kind) {
		case "service-healthcheck":
			return `Readiness: the service's healthcheck command must pass before the new ${workload} gets traffic.`;
		case "image-healthcheck":
			return `Readiness: the image's own HEALTHCHECK must pass before the new ${workload} gets traffic.`;
		case "listening":
			return `Readiness: no healthcheck configured, so Homerun added one that waits for port ${check.port} to be listening; the new ${workload} gets traffic only once it passes.`;
		case "none":
			return noReadinessDescription(check.reason, workload);
		default:
			return check satisfies never;
	}
}

function noReadinessDescription(
	reason: ReadinessGap,
	workload: ReadinessWorkload,
): string {
	switch (reason) {
		case "not-routed":
			return "Readiness: not published through Traefik, so there's no traffic to hold back.";
		case "udp-only":
			return `Readiness: a UDP-only port can't be checked, so the new ${workload} gets traffic as soon as it runs. Add a healthcheck command for a real gate.`;
		case "no-shell":
			return `Readiness: the image has no healthcheck and no /bin/sh to run one in, so the new ${workload} gets traffic as soon as it runs.`;
		case "image-unknown":
			return `Readiness: the image couldn't be inspected, so the new ${workload} gets traffic as soon as it runs.`;
		default:
			return reason satisfies never;
	}
}

function isRouted(input: ReadinessInput): boolean {
	return (
		input.dnsResolvable !== false &&
		input.networkMode !== "host" &&
		!input.remote
	);
}
