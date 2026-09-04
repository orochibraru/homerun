// DockerService : Docker operational surface for container lifecycle,
// networking, git-based builds, Traefik/custom-SSL config, status
// reconciliation, and the interactive terminal. Backs every route/DTO
// that touches a service's container or the shared Traefik/network infra.
//
// Built from real classes, not a bag of re-exported functions : each
// concern (containers, networks, reconcile, git-build, custom-ssl,
// core-services/Traefik, terminal) is its own class in services/docker/**,
// extending BaseDockerService, and all of them merge into one class here
// via the TS mixin pattern (each file exports a `SomethingMixin(Base)`
// function). `DockerService` is the single instantiated singleton of that
// merged class, every route/DTO imports this same instance and calls
// real inherited instance methods on it (`DockerService.pullImage(...)`),
// not static delegates to loose functions.

export type { ContainerStatus } from "$lib/types";
export type {
	CleanupCategory,
	CleanupItem,
	CleanupPreview,
	PruneSummary,
	SystemPruneSummary,
} from "./docker/cleanup.ts";
export type { RemoteHostConnection } from "./docker/client.ts";
export type {
	CreateContainerParams,
	PullProgressEvent,
	RegistryAuth,
	VolumeMountParams,
} from "./docker/containers.ts";

import { BaseDockerService } from "./docker/base.ts";
import { DockerCleanupMixin } from "./docker/cleanup.ts";
import { DockerContainerMixin } from "./docker/containers.ts";
import { DockerCoreServicesMixin } from "./docker/core-services.ts";
import { DockerCustomSslMixin } from "./docker/custom-ssl.ts";
import { DockerGitBuildMixin } from "./docker/git-build.ts";
import { DockerNetworkMixin } from "./docker/networks.ts";
import { DockerReconcileMixin } from "./docker/reconcile.ts";
import { DockerSwarmMixin } from "./docker/swarm.ts";
import { DockerTerminalMixin } from "./docker/terminal.ts";

// Merge order matters only where one concern calls another's methods via
// `this` : networks before containers (createAndStartContainer calls
// connectToProjectNetwork), containers before swarm (createAndStartSwarmService
// calls this.pullImage), containers+swarm before reconcile (syncServiceStatus
// calls both this.inspectStatus and this.inspectSwarmServiceStatus). The
// rest have no cross-concern dependency, so their position is arbitrary.
class DockerServiceClass extends DockerCleanupMixin(
	DockerTerminalMixin(
		DockerCoreServicesMixin(
			DockerCustomSslMixin(
				DockerGitBuildMixin(
					DockerReconcileMixin(
						DockerSwarmMixin(
							DockerContainerMixin(DockerNetworkMixin(BaseDockerService)),
						),
					),
				),
			),
		),
	),
) {}

export const DockerService = new DockerServiceClass();
