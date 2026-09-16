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
			return [registryTarget(plan.registry, ref), localScanTarget(ref)];
		default:
			return unreachable(plan);
	}
}
