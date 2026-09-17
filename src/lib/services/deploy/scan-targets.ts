import type { TrivySource } from "../docker/image-scan-refs.ts";
import {
	type CacheRegistryCredentials,
	type GitBuildPlan,
	unreachable,
} from "./plan.ts";

export interface ScanTarget {
	auth?: { password: string; serveraddress?: string; username: string };
	display?: string;
	label: string;
	ref: string;
	source: TrivySource;
}

/** A Trivy scan target for an image already on this Docker daemon, scanned via the local socket rather than a registry. */
export function localScanTarget(ref: string): ScanTarget {
	return { label: "the image on this host", ref, source: { kind: "docker" } };
}

function registryTarget(
	registry: CacheRegistryCredentials,
	ref: string,
): ScanTarget {
	return {
		auth: {
			password: registry.password,
			serveraddress: registry.registryUrl,
			username: registry.username,
		},
		label: `the pushed image in ${registry.registryUrl}`,
		ref,
		source: { insecure: false, kind: "remote" },
	};
}

/**
 * The Trivy scan targets to check for a just-built git image : a
 * local-build plan, or a build server with no cache registry (whose image
 * is streamed back onto this host), only has the local daemon copy to scan,
 * while a docker-build/agent-build plan with a registry scans both the pushed
 * registry copy and the local copy pulled back onto this host.
 */
export function buildScanTargets(
	plan: GitBuildPlan,
	built: { image: string; tag: string },
): ScanTarget[] {
	const ref = `${built.image}:${built.tag}`;
	switch (plan.kind) {
		case "local-build":
			return [localScanTarget(ref)];
		case "docker-build":
		case "agent-build":
			return plan.registry
				? [registryTarget(plan.registry, ref), localScanTarget(ref)]
				: [localScanTarget(ref)];
		default:
			return unreachable(plan);
	}
}
