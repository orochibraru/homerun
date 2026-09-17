/** The two ids a deployed service can be reached by: a plain container, or a swarm service. */
export interface ServiceWorkloadIds {
	containerId: string | null;
	swarmServiceId: string | null;
}

/**
 * The id of whatever a service's logs and terminal should talk to : its
 * container in standalone mode, its swarm service in swarm mode, null when
 * nothing is deployed.
 */
export function workloadId(svc: ServiceWorkloadIds): string | null {
	return svc.containerId ?? svc.swarmServiceId;
}

/**
 * Whether a service has a workload to talk to : a container id in standalone
 * mode, a swarm service id in swarm mode. Exactly one of the two is set once a
 * deploy succeeds (see DeploymentService's `#recordSuccess`).
 *
 * Shared by the log routes and every panel that renders a log stream, because
 * having that rule in two places is what broke: the UI gated its log panel on
 * `containerId` alone, so on a swarm instance a perfectly healthy service was
 * told "This service hasn't been deployed yet" while the server endpoint behind
 * it would have streamed its logs happily.
 *
 * Deliberately says nothing about health: a stopped, failed or unhealthy
 * service still has logs, and they're the first thing anyone wants to read.
 */
export function isDeployed(svc: ServiceWorkloadIds): boolean {
	return Boolean(svc.containerId || svc.swarmServiceId);
}
