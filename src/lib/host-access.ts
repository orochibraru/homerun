export const HOST_ACCESS_MESSAGE =
	"Setting privileged mode, devices, added capabilities or env files needs write access to System : each of them gives the container access to the host.";

export interface HostAccessOptions {
	capAdd?: string[];
	devices?: string[];
	envFiles?: string[];
	privileged?: boolean;
}

/** Whether a new service's options ask for anything host-level: privileged mode, a device, an added capability or a host env file. */
export function hostAccessRequested(options: HostAccessOptions): boolean {
	return (
		options.privileged === true ||
		(options.capAdd?.length ?? 0) > 0 ||
		(options.devices?.length ?? 0) > 0 ||
		(options.envFiles?.length ?? 0) > 0
	);
}

/**
 * Whether an update changes any host-level option away from what the
 * service has now. A field left out of `next` is unchanged; a list compares
 * by its exact entries, in order.
 */
export function hostAccessChanged(
	current: HostAccessOptions,
	next: HostAccessOptions,
): boolean {
	const lists = ["capAdd", "devices", "envFiles"] as const;
	return (
		(next.privileged !== undefined &&
			next.privileged !== (current.privileged ?? false)) ||
		lists.some(
			(key) =>
				next[key] !== undefined &&
				JSON.stringify(next[key]) !== JSON.stringify(current[key] ?? []),
		)
	);
}

/**
 * The names of the templates in a deploy (the primary and its linked
 * companions) that ask for host-level access, in order. Empty when a
 * non-admin may deploy all of them.
 */
export function templatesNeedingHostAccess(
	templates: (HostAccessOptions & { name: string })[],
): string[] {
	return templates
		.filter((template) => hostAccessRequested(template))
		.map((template) => template.name);
}

/** The refusal a non-admin gets for deploying templates that need host access, naming each one. */
export function templateHostAccessMessage(names: string[]): string {
	const quoted = names.map((name) => `"${name}"`).join(", ");
	return `${quoted} ${names.length === 1 ? "needs" : "need"} host access (privileged mode, devices, added capabilities or env files) : deploying ${names.length === 1 ? "it" : "them"} needs write access to System.`;
}
