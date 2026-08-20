// Slim barrel over src/lib/services/docker/** — every route/DTO that needs
// a Docker operation imports DockerService (and its re-exported types) from
// here, never reaching into services/docker/* directly. The subfolder keeps
// the same per-concern file split the old src/lib/server/docker/ already
// had; this file just presents one stable, named surface over it.

export type { ContainerStatus } from "$lib/types";
export type { RemoteHostConnection } from "./docker/client.ts";
export type {
	CreateContainerParams,
	PullProgressEvent,
	RegistryAuth,
	VolumeMountParams,
} from "./docker/containers.ts";

import { getDocker } from "./docker/client.ts";
import {
	buildAuthConfig,
	createAndStartContainer,
	inspectStatus,
	listManagedContainers,
	pullImage,
	removeContainer,
	restartContainer,
	startContainer,
	stopContainer,
	streamLogs,
} from "./docker/containers.ts";
import {
	findTraefikContainer,
	restartTraefikContainer,
	updateTraefikContainer,
} from "./docker/core-services.ts";
import { syncCustomSslConfig } from "./docker/custom-ssl.ts";
import { buildFromGit } from "./docker/git-build.ts";
import {
	connectToProjectNetwork,
	ensureProjectNetwork,
	removeProjectNetwork,
} from "./docker/networks.ts";
import {
	syncAllServiceStatuses,
	syncServiceStatus,
} from "./docker/reconcile.ts";
import {
	closeSession,
	openTerminalSession,
	ownsSession,
	subscribeToSession,
	writeToSession,
} from "./docker/terminal.ts";

/**
 * Docker operational surface — container lifecycle, networking, git-based
 * builds, Traefik/custom-SSL config, status reconciliation, and the
 * interactive terminal. Backs every route/DTO that touches a service's
 * container or the shared Traefik/network infra. See services/docker/** for
 * the actual implementations, split by concern.
 */
export class DockerService {
	static getDocker = getDocker;

	// Container lifecycle
	static buildAuthConfig = buildAuthConfig;
	static pullImage = pullImage;
	static createAndStartContainer = createAndStartContainer;
	static startContainer = startContainer;
	static stopContainer = stopContainer;
	static restartContainer = restartContainer;
	static removeContainer = removeContainer;
	static inspectStatus = inspectStatus;
	static streamLogs = streamLogs;
	static listManagedContainers = listManagedContainers;

	// Networking
	static ensureProjectNetwork = ensureProjectNetwork;
	static removeProjectNetwork = removeProjectNetwork;
	static connectToProjectNetwork = connectToProjectNetwork;

	// Status reconciliation
	static syncServiceStatus = syncServiceStatus;
	static syncAllServiceStatuses = syncAllServiceStatuses;

	// Git-based builds
	static buildFromGit = buildFromGit;

	// Custom SSL / Traefik dynamic config
	static syncCustomSslConfig = syncCustomSslConfig;

	// Traefik container management (Homerun's own infra container)
	static findTraefikContainer = findTraefikContainer;
	static restartTraefikContainer = restartTraefikContainer;
	static updateTraefikContainer = updateTraefikContainer;

	// Web terminal
	static openTerminalSession = openTerminalSession;
	static subscribeToSession = subscribeToSession;
	static writeToSession = writeToSession;
	static closeSession = closeSession;
	static ownsSession = ownsSession;
}
