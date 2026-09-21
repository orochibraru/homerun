import { createHash } from "node:crypto";
import { dockerHealthcheck } from "./healthcheck.ts";

/**
 * A Docker Engine container-create body, as much of it as a core container's
 * spec sets. `name` is carried alongside the rest here and split back out by
 * the caller, since the Engine takes it as a query parameter rather than a
 * body field.
 */
export interface ContainerCreateOptions {
	Env?: string[];
	Healthcheck?: Record<string, unknown>;
	HostConfig?: Record<string, unknown>;
	Image?: string;
	Labels?: Record<string, string>;
	name?: string;
}

export interface NewtCredentials {
	endpoint: string;
	id: string;
	secret: string;
}

export const NEWT_CONTAINER_NAME = "homerun-newt";
export const NEWT_IMAGE = "fosrl/newt:latest";
export const CORE_LABEL = "homerun.core";
export const CORE_HASH_LABEL = "homerun.core.hash";
export const NEWT_HEALTHCHECK =
	"wget -qO- http://127.0.0.1:2112/metrics | grep -Eq '^newt_websocket_connected(\\{[^}]*\\})? 1$'";

/**
 * The create options for Homerun's own Newt container on `network`, labelled
 * with a hash of everything that shapes it so a sync can tell whether the
 * running container is still the one it would create.
 */
export function newtContainerSpec(
	credentials: NewtCredentials,
	network: string,
): ContainerCreateOptions {
	const env = [
		`PANGOLIN_ENDPOINT=${credentials.endpoint}`,
		`NEWT_ID=${credentials.id}`,
		`NEWT_SECRET=${credentials.secret}`,
		"NEWT_METRICS_PROMETHEUS_ENABLED=true",
	];
	const hash = createHash("sha256")
		.update(JSON.stringify([NEWT_IMAGE, network, NEWT_HEALTHCHECK, env]))
		.digest("hex");
	return {
		Env: env,
		Healthcheck: dockerHealthcheck(NEWT_HEALTHCHECK),
		HostConfig: {
			NetworkMode: network,
			RestartPolicy: { Name: "unless-stopped" },
		},
		Image: NEWT_IMAGE,
		Labels: { [CORE_HASH_LABEL]: hash, [CORE_LABEL]: "newt" },
		name: NEWT_CONTAINER_NAME,
	};
}
