export interface ContainerRuntimeParams {
	capAdd: string[];
	command: string[] | null;
	devices: string[];
	entrypoint: string[] | null;
	labels: Record<string, string>;
	privileged: boolean;
}

export interface DeviceMapping {
	CgroupPermissions: string;
	PathInContainer: string;
	PathOnHost: string;
}

const CGROUP_PERMISSIONS_RE = /^[rwm]+$/;

/**
 * Parses one `host[:container[:permissions]]` device entry, the same short
 * form `docker run --device` and compose's `devices:` take, into the Engine
 * API's device mapping. The container path defaults to the host path and the
 * permissions to `rwm`; a two-part entry whose second part is only `rwm`
 * letters is read as host path plus permissions.
 */
export function deviceMappingFor(spec: string): DeviceMapping {
	const [host = "", second, third] = spec.split(":");
	if (
		second !== undefined &&
		third === undefined &&
		CGROUP_PERMISSIONS_RE.test(second)
	) {
		return {
			CgroupPermissions: second,
			PathInContainer: host,
			PathOnHost: host,
		};
	}
	return {
		CgroupPermissions: third || "rwm",
		PathInContainer: second || host,
		PathOnHost: host,
	};
}

/**
 * Normalizes a capability name to the form the Engine API expects, upper
 * case with a `CAP_` prefix, so `net_admin` and `CAP_NET_ADMIN` both work.
 */
export function capabilityName(name: string): string {
	const upper = name.trim().toUpperCase();
	return upper.startsWith("CAP_") ? upper : `CAP_${upper}`;
}

/**
 * Merges a service's own labels under the ones Homerun writes : on a key
 * collision Homerun's label wins, so a custom label can never break the
 * service's tracking or routing.
 */
export function mergeLabels(
	custom: Record<string, string> | undefined,
	own: Record<string, string>,
): Record<string, string> {
	return { ...(custom ?? {}), ...own };
}

/** The `Cmd`/`Entrypoint` overrides for a container create, leaving either unset (the image's own) when the service doesn't override it. */
export function runtimeArgv(runtime: ContainerRuntimeParams | undefined): {
	Cmd?: string[];
	Entrypoint?: string[];
} {
	return {
		Cmd: runtime?.command ?? undefined,
		Entrypoint: runtime?.entrypoint ?? undefined,
	};
}

/** The `HostConfig` fields for added capabilities, device mappings and privileged mode, each left unset when the service doesn't use it. */
export function runtimeHostConfig(
	runtime: ContainerRuntimeParams | undefined,
): {
	CapAdd?: string[];
	Devices?: DeviceMapping[];
	Privileged?: boolean;
} {
	return {
		CapAdd: runtime?.capAdd.length
			? runtime.capAdd.map(capabilityName)
			: undefined,
		Devices: runtime?.devices.length
			? runtime.devices.map(deviceMappingFor)
			: undefined,
		Privileged: runtime?.privileged || undefined,
	};
}
