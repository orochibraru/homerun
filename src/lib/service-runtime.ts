import { joinShellWords } from "$lib/shell-words";

export interface ServiceRuntimeOptions {
	capAdd: string[];
	command: string[] | null;
	devices: string[];
	entrypoint: string[] | null;
	envFiles: string[];
	labels: Record<string, string>;
	privileged: boolean;
}

/**
 * A service's container runtime overrides (command, entrypoint, env files,
 * labels, added capabilities, devices, privileged mode) read off a service
 * row or a partial create input, with every missing field at its default:
 * the image's own argv, no files, labels, capabilities or devices, and not
 * privileged.
 */
export function runtimeOptionsFrom(
	source: Partial<ServiceRuntimeOptions> | null | undefined,
): ServiceRuntimeOptions {
	return {
		capAdd: source?.capAdd ?? [],
		command: source?.command ?? null,
		devices: source?.devices ?? [],
		entrypoint: source?.entrypoint ?? null,
		envFiles: source?.envFiles ?? [],
		labels: source?.labels ?? {},
		privileged: source?.privileged ?? false,
	};
}

/**
 * One short line per runtime override that differs from the default, for
 * showing what a template or service changes about how its container
 * starts. Empty when nothing is overridden.
 */
export function runtimeOptionsSummary(
	source: Partial<ServiceRuntimeOptions> | null | undefined,
): string[] {
	const options = runtimeOptionsFrom(source);
	const lines: string[] = [];
	if (options.entrypoint) {
		lines.push(`Entrypoint: ${joinShellWords(options.entrypoint)}`);
	}
	if (options.command) {
		lines.push(`Command: ${joinShellWords(options.command)}`);
	}
	const labelCount = Object.keys(options.labels).length;
	if (labelCount > 0) {
		lines.push(`${labelCount} label${labelCount === 1 ? "" : "s"}`);
	}
	if (options.envFiles.length > 0) {
		lines.push(`Env files: ${options.envFiles.join(", ")}`);
	}
	if (options.capAdd.length > 0) {
		lines.push(`Added capabilities: ${options.capAdd.join(", ")}`);
	}
	if (options.devices.length > 0) {
		lines.push(`Devices: ${options.devices.join(", ")}`);
	}
	if (options.privileged) {
		lines.push("Runs privileged");
	}
	return lines;
}
