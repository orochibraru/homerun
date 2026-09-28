import type { PublishedPort } from "$lib/published-ports";
import {
	runtimeOptionsFrom,
	type ServiceRuntimeOptions,
} from "$lib/service-runtime";

export interface VolumeMountSnapshot {
	containerPath: string;
	readOnly: boolean;
	volumeId: string;
}

export interface RevisionConfig extends Partial<ServiceRuntimeOptions> {
	containerPort: number;
	cpuLimit: string | null;
	dnsResolvable: boolean;
	envVars: Record<string, string>;
	memoryLimitMb: number | null;
	networkMode: "bridge" | "host";
	portProtocol: "tcp" | "udp" | "both";
	publishedPorts?: PublishedPort[];
	replicas: number;
	volumeMounts?: VolumeMountSnapshot[];
}

type SnapshotFields = Required<Omit<RevisionConfig, "volumeMounts">>;

export type RevisionConfigSource = {
	[Key in keyof SnapshotFields]: Key extends "envVars"
		? Record<string, string> | null
		: SnapshotFields[Key];
};

const RUNTIME_KEYS = [
	"capAdd",
	"command",
	"devices",
	"entrypoint",
	"envFiles",
	"labels",
	"privileged",
	"runAsUser",
] as const satisfies ReadonlyArray<keyof ServiceRuntimeOptions>;

export type BackupRunKind = "backup" | "restore";

/** The env vars, resources, networking and runtime options a deploy ran with, as recorded on its deployment row so a rollback can put them back. */
export function snapshotRevisionConfig(
	service: RevisionConfigSource,
): RevisionConfig {
	return {
		...structuredClone(runtimeOptionsFrom(service)),
		containerPort: service.containerPort,
		cpuLimit: service.cpuLimit,
		dnsResolvable:
			service.networkMode === "host" ? false : service.dnsResolvable,
		envVars: { ...service.envVars },
		memoryLimitMb: service.memoryLimitMb,
		networkMode: service.networkMode,
		portProtocol: service.portProtocol,
		publishedPorts: structuredClone(service.publishedPorts),
		replicas: service.replicas,
	};
}

/**
 * The runtime options a snapshot recorded, to write back onto the service. A
 * snapshot taken before runtime options were recorded has none, and restoring
 * it leaves the service's current ones alone.
 */
export function restorableRuntimeOptions(
	snapshot: RevisionConfig,
): Partial<ServiceRuntimeOptions> {
	return Object.fromEntries(
		RUNTIME_KEYS.filter((key) => snapshot[key] !== undefined).map((key) => [
			key,
			snapshot[key],
		]),
	);
}

/** The fields that differ between a service's current config and a revision's snapshot, by name, for the rollback log line. */
export function changedRevisionConfigFields(
	current: RevisionConfigSource,
	snapshot: RevisionConfig,
	currentMounts: VolumeMountSnapshot[] = [],
): Array<keyof RevisionConfig> {
	const now: RevisionConfig = {
		...snapshotRevisionConfig(current),
		volumeMounts: sortedMounts(currentMounts),
	};
	const recorded: RevisionConfig = snapshot.volumeMounts
		? { ...snapshot, volumeMounts: sortedMounts(snapshot.volumeMounts) }
		: snapshot;
	return (Object.keys(snapshot) as Array<keyof RevisionConfig>)
		.filter((field) => comparable(now[field]) !== comparable(recorded[field]))
		.sort((a, b) => a.localeCompare(b));
}

function comparable(value: RevisionConfig[keyof RevisionConfig]): string {
	if (value && typeof value === "object") {
		return JSON.stringify(
			Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
		);
	}
	return JSON.stringify(value);
}

/** Mounts in a stable order with stable keys, so two lists of the same mounts compare equal. */
function sortedMounts(mounts: VolumeMountSnapshot[]): VolumeMountSnapshot[] {
	return mounts
		.map(({ containerPath, readOnly, volumeId }) => ({
			containerPath,
			readOnly,
			volumeId,
		}))
		.sort((a, b) => a.containerPath.localeCompare(b.containerPath));
}
