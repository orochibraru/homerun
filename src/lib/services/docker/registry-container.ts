import { config } from "$lib/config";
import { certResolverFor } from "./cert-resolver.ts";
import {
	MIRROR_AUTH_ENV,
	MIRROR_DELETE_ENV,
	MIRROR_INTERNAL_PORT,
	MIRROR_LABEL,
	MIRROR_ROUTER,
} from "./image-scan-refs.ts";

/** How the registry container should currently be configured. */
export interface RegistryDesiredState {
	authEnabled: boolean;
	publicHost: string | null;
}

/**
 * The registry container's environment: deletes are always on (the mirror
 * garbage collector needs them), htpasswd auth only when it's turned on.
 */
export function registryEnv(state: RegistryDesiredState): string[] {
	return state.authEnabled
		? [MIRROR_DELETE_ENV, ...MIRROR_AUTH_ENV]
		: [MIRROR_DELETE_ENV];
}

/**
 * The registry container's labels: its own infra marker, plus a Traefik router
 * when it's published at a hostname. `docker push` streams whole layers, so the
 * router gets no buffering middleware; Traefik passes them through as they come.
 *
 * Publishing is only ever reached with auth on (RegistryService refuses
 * otherwise), so this never exposes an anonymous-write registry.
 */
export function registryLabels(
	state: RegistryDesiredState,
): Record<string, string> {
	const labels: Record<string, string> = { [MIRROR_LABEL]: "mirror" };
	if (!state.publicHost) {
		return labels;
	}
	const resolver = certResolverFor(
		state.publicHost,
		config.traefik.certResolver,
		config.pangolinOwnsAuth,
	);
	labels["traefik.enable"] = "true";
	labels[`traefik.http.routers.${MIRROR_ROUTER}.rule`] =
		`Host(\`${state.publicHost}\`)`;
	labels[`traefik.http.routers.${MIRROR_ROUTER}.entrypoints`] =
		config.traefik.entrypoint;
	labels[`traefik.http.services.${MIRROR_ROUTER}.loadbalancer.server.port`] =
		String(MIRROR_INTERNAL_PORT);
	if (resolver) {
		labels[`traefik.http.routers.${MIRROR_ROUTER}.tls`] = "true";
		labels[`traefik.http.routers.${MIRROR_ROUTER}.tls.certresolver`] = resolver;
	}
	return labels;
}

/**
 * Whether a running container already matches `state`, so it can be left alone.
 * Compares only what this module sets: the env entries and the Traefik labels.
 * Anything else Docker adds to either is ignored.
 */
export function registryMatches(
	env: string[],
	labels: Record<string, string>,
	state: RegistryDesiredState,
): boolean {
	const wantedEnv = registryEnv(state);
	if (!wantedEnv.every((entry) => env.includes(entry))) {
		return false;
	}
	if (
		!state.authEnabled &&
		MIRROR_AUTH_ENV.some((entry) => env.includes(entry))
	) {
		return false;
	}
	const wantedLabels = registryLabels(state);
	const traefikKeys = new Set(
		[...Object.keys(labels), ...Object.keys(wantedLabels)].filter((key) =>
			key.startsWith("traefik."),
		),
	);
	return [...traefikKeys].every((key) => labels[key] === wantedLabels[key]);
}
