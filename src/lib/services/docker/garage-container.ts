import { config } from "#lib/config.js";
import { GARAGE_REGION } from "#lib/object-storage.js";
import { certResolverFor } from "./cert-resolver.ts";
import { MIRROR_LABEL } from "./image-scan-refs.ts";

export const GARAGE_CONTAINER_NAME = "homerun-garage";
export const GARAGE_IMAGE = "dxflrs/garage";
export const GARAGE_IMAGE_TAG = "v2.4.1";
export const GARAGE_S3_PORT = 3900;
export const GARAGE_ADMIN_PORT = 3903;
export const GARAGE_S3_HOST_PORT = 5056;
export const GARAGE_ADMIN_HOST_PORT = 5057;
export const GARAGE_META_VOLUME = "homerun-garage-meta";
export const GARAGE_DATA_VOLUME = "homerun-garage-data";
export const GARAGE_CONFIG_VOLUME = "homerun-garage-config";
export const GARAGE_CONFIG_DIR = "/etc/garage";
export const GARAGE_CONFIG_FILE = `${GARAGE_CONFIG_DIR}/garage.toml`;
export const GARAGE_META_DIR = "/var/lib/garage/meta";
export const GARAGE_DATA_DIR = "/var/lib/garage/data";
export const GARAGE_ROUTER = "homerun-garage";

/** How the Garage container should currently be configured. */
export interface GarageDesiredState {
	adminToken: string;
	publicHost: string | null;
	rpcSecret: string;
}

/**
 * Garage's config file. It holds no secret: the RPC secret and admin token
 * reach the container as environment variables, so the file never changes
 * and can sit in a volume written once.
 */
export function garageToml(): string {
	return [
		`metadata_dir = "${GARAGE_META_DIR}"`,
		`data_dir = "${GARAGE_DATA_DIR}"`,
		'db_engine = "sqlite"',
		"replication_factor = 1",
		'rpc_bind_addr = "[::]:3901"',
		'rpc_public_addr = "127.0.0.1:3901"',
		"",
		"[s3_api]",
		`api_bind_addr = "[::]:${GARAGE_S3_PORT}"`,
		`s3_region = "${GARAGE_REGION}"`,
		"",
		"[admin]",
		`api_bind_addr = "[::]:${GARAGE_ADMIN_PORT}"`,
		"",
	].join("\n");
}

/** The container's environment: the two secrets Garage reads instead of its config file. */
export function garageEnv(state: GarageDesiredState): string[] {
	return [
		`GARAGE_RPC_SECRET=${state.rpcSecret}`,
		`GARAGE_ADMIN_TOKEN=${state.adminToken}`,
	];
}

/**
 * The container's labels: its infra marker, plus a Traefik router to the S3
 * API when it's published at a hostname. Only the S3 port is ever routed, the
 * admin API stays on the shared network and the loopback port.
 */
export function garageLabels(
	state: GarageDesiredState,
): Record<string, string> {
	const labels: Record<string, string> = { [MIRROR_LABEL]: "garage" };
	if (!state.publicHost) {
		return labels;
	}
	const resolver = certResolverFor(
		state.publicHost,
		config.traefik.certResolver,
		config.pangolinEnabled,
		config.traefik.instanceCertNames,
	);
	labels["traefik.enable"] = "true";
	labels[`traefik.http.routers.${GARAGE_ROUTER}.rule`] =
		`Host(\`${state.publicHost}\`)`;
	labels[`traefik.http.routers.${GARAGE_ROUTER}.entrypoints`] =
		config.traefik.entrypoint;
	labels[`traefik.http.routers.${GARAGE_ROUTER}.service`] = GARAGE_ROUTER;
	labels[`traefik.http.services.${GARAGE_ROUTER}.loadbalancer.server.port`] =
		String(GARAGE_S3_PORT);
	labels[`traefik.http.routers.${GARAGE_ROUTER}.tls`] = "true";
	if (resolver) {
		labels[`traefik.http.routers.${GARAGE_ROUTER}.tls.certresolver`] = resolver;
	}
	return labels;
}

/**
 * Whether a container already runs with `state`'s secrets and Traefik labels,
 * so it can be left alone. Anything else Docker adds is ignored.
 */
export function garageMatches(
	env: string[],
	labels: Record<string, string>,
	state: GarageDesiredState,
): boolean {
	if (!garageEnv(state).every((entry) => env.includes(entry))) {
		return false;
	}
	const wanted = garageLabels(state);
	const traefikKeys = new Set(
		[...Object.keys(labels), ...Object.keys(wanted)].filter((key) =>
			key.startsWith("traefik."),
		),
	);
	return [...traefikKeys].every((key) => labels[key] === wanted[key]);
}
